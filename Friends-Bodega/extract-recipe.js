
exports.handler = async function (event, context) {

    // STEP 1: Only allow POST requests 
    // POST = "I'm sending you data to process"
    // GET  = "I just want to read something"
    // We only want to process data, so we reject anything else.
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
        };
    }

    // STEP 2: Read what the website sent us
    // The website sends us a JSON object with either:
    //   { type: "text",  content: "2 cups flour, 1 egg..." }
    //   { type: "image", content: "data:image/jpeg;base64,..." }
    let requestBody;
    try {
        requestBody = JSON.parse(event.body);
    } catch (err) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid JSON in request body.' })
        };
    }

    const { type, content, dishName } = requestBody;

    // Basic validation — we need something to work with
    if (!type || !content) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing type or content in request.' })
        };
    }

    // STEP 3: Get the secret API key 
    // process.env.ANTHROPIC_API_KEY reads the environment
    // variable you set in Netlify's dashboard.
    // On your LOCAL computer you'll put this in a .env file.
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'API key not configured. Add ANTHROPIC_API_KEY in Netlify environment variables.'
            })
        };
    }

    // STEP 4: Build the message for Claude
    // Claude accepts either plain text OR an image.
    // We build a different message depending on which was sent.

    let claudeMessages;

    if (type === 'text') {
        // TEXT MODE: user typed or pasted a recipe
        claudeMessages = [
            {
                role: 'user',
                content: `Here is a recipe. Please extract and structure it:\n\n${content}`
            }
        ];
    } else if (type === 'image') {
        // IMAGE MODE: user uploaded a food photo
        // Claude can "see" images when we send them as base64.
        // base64 is just a way of turning image bytes into text.

        // The browser sends "data:image/jpeg;base64,/9j/4AA..."
        // We need to split it into the media type and the data.
        const [metaPart, base64Data] = content.split(',');
        // metaPart looks like "data:image/jpeg;base64"
        const mediaType = metaPart.split(':')[1].split(';')[0];
        // mediaType is now "image/jpeg"

        claudeMessages = [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaType,
                            data: base64Data
                        }
                    },
                    {
                        type: 'text',
                        text: dishName
                            ? `This is a photo of "${dishName}". Please create a recipe for this dish.`
                            : 'Please look at this food photo and create a recipe for what you see.'
                    }
                ]
            }
        ];
    } else {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'type must be "text" or "image".' })
        };
    }

    // STEP 5: The system prompt 
    // This tells Claude WHO it is and WHAT FORMAT to return.
    // Claude will always follow these instructions.
    const systemPrompt = `You are a recipe extraction assistant for FriendsBodega Recipes.

The user will give you either:
- A photo of a finished dish, OR
- A typed or pasted recipe

Your job is to return a structured JSON object in EXACTLY this shape — no explanation, no markdown, no code fences, just raw JSON:

{
  "title": "Recipe Name",
  "servings": "Makes X servings",
  "prepSteps": [
    "Preheat oven to 350°F / 175°C",
    "Grease a 9x5 loaf pan"
  ],
  "ingredients": [
    {
      "name": "1/2 cup / 115g butter, softened",
      "step1": "cream",
      "step2": null,
      "step3": null,
      "step4": null,
      "step5": null
    }
  ],
  "stepHeaders": ["Step 1 label", "Step 2 label", "Step 3 label", "Step 4 label", "Step 5 label"],
  "finalNote": "Cool on wire rack for 10 minutes before slicing."
}

RULES:
1. ingredients are ROWS in the table
2. stepHeaders are COLUMNS — use short cooking action words (cream, fold, bake, rest)
3. For each ingredient, fill the step it participates in with the action word, leave others null
4. Use BOTH cups and grams where relevant: "2 cups / 250g flour"
5. Max 5 step columns. If fewer steps needed, use fewer — set unused stepHeaders entries to null
6. prepSteps are setup actions done before cooking starts (preheat, grease pan, etc)
7. If given a food photo with no recipe, infer a traditional recipe for that dish
8. Keep ingredient names concise but complete
9. Return ONLY valid JSON — no explanation, no markdown, no backticks`;

    // STEP 6: Call the Claude API 
    // This is a standard "fetch" request to Anthropic's servers.
    // fetch() is how JavaScript talks to external APIs.
    let claudeResponse;
    try {
        claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type':      'application/json',
                'x-api-key':         apiKey,             // our secret key
                'anthropic-version': '2023-06-01'        // required by the API
            },
            body: JSON.stringify({
                model:      'claude-sonnet-4-6',          // the AI model
                max_tokens: 2000,                         // max length of response
                system:     systemPrompt,                 // the instructions above
                messages:   claudeMessages                // what the user sent
            })
        });
    } catch (fetchError) {
        return {
            statusCode: 502,
            body: JSON.stringify({ error: 'Failed to reach Claude API: ' + fetchError.message })
        };
    }

    // STEP 7: Check the API responded OK 
    if (!claudeResponse.ok) {
        const errorText = await claudeResponse.text();
        return {
            statusCode: claudeResponse.status,
            body: JSON.stringify({ error: 'Claude API error: ' + errorText })
        };
    }

    //STEP 8: Read Claude's response 
    const claudeData = await claudeResponse.json();
    // claudeData.content is an array; [0].text is the actual reply
    const rawText = claudeData.content[0].text.trim();

    //STEP 9: Parse Claude's JSON reply 
    // Claude should return pure JSON (we told it to in the prompt).
    // But just in case it wraps it in ```json ... ```, we strip that.
    let recipeJSON;
    try {
        const cleaned = rawText
            .replace(/^```json\s*/i, '')  // remove opening ```json
            .replace(/^```\s*/i, '')      // remove opening ```
            .replace(/\s*```$/i, '');     // remove closing ```
        recipeJSON = JSON.parse(cleaned);
    } catch (parseError) {
        // If we can't parse it, return the raw text so we can debug
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Could not parse Claude response as JSON.',
                raw: rawText
            })
        };
    }

    // STEP 10: Send the recipe back to the website 
    // "statusCode: 200" means "everything worked fine"
    // "Access-Control-Allow-Origin: *" lets our website call this function
    return {
        statusCode: 200,
        headers: {
            'Content-Type':                'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ recipe: recipeJSON })
    };
};
