// ============================================================
// FRIENDSBODEGA — recipe-generator.js
//
// WHAT IS THIS FILE?
// ------------------
// This is the JavaScript that runs IN THE BROWSER.
// It handles everything the user sees and does on the page:
//
//   1. Listens for the "Generate" button click
//   2. Grabs the photo or text the user provided
//   3. Sends it to our Netlify function (extract-recipe.js)
//   4. Receives the recipe JSON back
//   5. Builds the recipe card table from that JSON
//   6. Shows the result with a download button
//
// HOW TO CONNECT THIS FILE TO YOUR HTML:
// Add this line just before </body> in index.html:
// <script src="recipe-generator.js"></script>
// ============================================================


// ── HELPER: Show a status message to the user ─────────────
// We'll call this function throughout to keep the user informed
function setStatus(message, type = 'info') {
    // type can be: 'info', 'loading', 'error', 'success'
    const statusEl = document.getElementById('generatorStatus');
    if (!statusEl) return;

    // Map type to an emoji prefix
    const prefix = {
        info:    'ℹ️',
        loading: '⏳',
        error:   '❌',
        success: '✅'
    }[type] || '';

    statusEl.textContent = prefix + ' ' + message;
    statusEl.className   = 'generator-status ' + type;
    statusEl.style.display = 'block';
}

function hideStatus() {
    const statusEl = document.getElementById('generatorStatus');
    if (statusEl) statusEl.style.display = 'none';
}


// ── HELPER: Convert an image File to base64 string ────────
// The Claude API needs images as base64 (text format).
// This function reads a File object and returns a Promise
// that resolves to the base64 string.
function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        // "onload" fires when the file has been read
        reader.onload  = function (e) { resolve(e.target.result); };
        // "onerror" fires if something goes wrong
        reader.onerror = function ()  { reject(new Error('Failed to read image file.')); };
        // Start reading — result will be "data:image/jpeg;base64,..."
        reader.readAsDataURL(file);
    });
}


// ── HELPER: Build the recipe table HTML from JSON ─────────
// This takes the JSON Claude returns and turns it into
// real HTML table rows and columns.
//
// The JSON looks like this:
// {
//   title: "Jollof Rice",
//   servings: "Serves 4",
//   prepSteps: ["Wash rice", "Dice onions"],
//   stepHeaders: ["fry", "add", "simmer", null, null],
//   ingredients: [
//     { name: "2 cups rice", step1: null, step2: "add", step3: "simmer", step4: null, step5: null },
//     { name: "1 onion",     step1: "fry", step2: null, step3: null,     step4: null, step5: null }
//   ],
//   finalNote: "Rest 5 min before serving."
// }
function buildRecipeCard(recipe) {

    // Filter out null step headers — only keep real steps
    // e.g. ["fry", "add", "simmer", null, null] → ["fry", "add", "simmer"]
    const activeSteps = (recipe.stepHeaders || []).filter(function (s) { return s !== null; });
    const stepCount   = activeSteps.length;

    // ── Build prep steps rows ──────────────────────────────
    let prepRowsHTML = '';
    if (recipe.prepSteps && recipe.prepSteps.length > 0) {
        prepRowsHTML = recipe.prepSteps.map(function (step) {
            return `
                <div class="prep-row">
                    <span class="prep-label">PREP</span>
                    <span>${escapeHTML(step)}</span>
                </div>`;
        }).join('');
    }

    // ── Build table header row ─────────────────────────────
    // First column is "Ingredient", then one column per step
    let headerCellsHTML = '<th class="col-ingredient">Ingredient</th>';
    activeSteps.forEach(function (stepLabel) {
        headerCellsHTML += `<th>${escapeHTML(stepLabel)}</th>`;
    });

    // ── Build ingredient rows ──────────────────────────────
    let ingredientRowsHTML = '';
    (recipe.ingredients || []).forEach(function (ingredient) {
        // Each ingredient has step1 through step5
        // We only render cells for active steps
        let cellsHTML = `<td>${escapeHTML(ingredient.name)}</td>`;

        for (let i = 1; i <= stepCount; i++) {
            const stepKey   = 'step' + i;      // "step1", "step2", etc.
            const stepValue = ingredient[stepKey]; // could be "fry" or null

            if (stepValue) {
                // This ingredient participates in this step — show the action
                cellsHTML += `<td class="action-cell">${escapeHTML(stepValue)}</td>`;
            } else {
                // Empty cell — ingredient doesn't belong to this step
                cellsHTML += '<td></td>';
            }
        }

        ingredientRowsHTML += `<tr>${cellsHTML}</tr>`;
    });

    // ── Build the final note ───────────────────────────────
    const finalNoteHTML = recipe.finalNote
        ? `<div class="frc-final-note">★ ${escapeHTML(recipe.finalNote)}</div>`
        : '';

    // ── Assemble the full card HTML ────────────────────────
    return `
        <div class="frc-header">
            <div class="frc-brand">★ FriendsBodega Recipes</div>
            <div class="frc-divider"></div>
            <h2 class="frc-title">${escapeHTML(recipe.title || 'My Recipe')}</h2>
            <p class="frc-serves">${escapeHTML(recipe.servings || '')}</p>
        </div>

        ${prepRowsHTML ? `<div class="frc-prep">${prepRowsHTML}</div>` : ''}

        <div class="frc-table-wrap">
            <table class="frc-table" aria-label="${escapeHTML(recipe.title || 'Recipe')} table">
                <thead>
                    <tr>${headerCellsHTML}</tr>
                </thead>
                <tbody>
                    ${ingredientRowsHTML}
                </tbody>
            </table>
        </div>

        ${finalNoteHTML}

        <div class="frc-footer">
            <span>READ LEFT TO RIGHT — EACH COLUMN BUILDS ON THE LAST.</span>
            <span>★ friendsbodega.recipes</span>
        </div>`;
}


// ── HELPER: Escape HTML special characters ─────────────────
// This prevents XSS attacks — if a recipe title contains
// "<script>" we don't want that to actually run as code!
// We turn < into &lt; and > into &gt; etc.
function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}


// ── HELPER: Scroll smoothly to an element ─────────────────
function scrollTo(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}


// ── MAIN: Handle the Generate button click ─────────────────
// This is the core function that wires everything together.
async function handleGenerate() {

    const generateBtn = document.getElementById('generateBtn');

    // ── 1. Figure out which tab is active ─────────────────
    // Is the user on the Photo tab or the Text tab?
    const photoTab   = document.getElementById('tab-photo');
    const isPhotoTab = photoTab && photoTab.classList.contains('active');

    // ── 2. Collect the user's input ───────────────────────
    let requestPayload; // This is what we'll send to our function

    if (isPhotoTab) {
        // PHOTO MODE
        const photoInput = document.getElementById('photoInput');
        const dishName   = document.getElementById('dishName');

        // Check that a photo was actually uploaded
        if (!photoInput || !photoInput.files || photoInput.files.length === 0) {
            setStatus('Please upload a food photo first.', 'error');
            return; // Stop here — nothing to do
        }

        // Convert the image File to base64
        setStatus('Reading your photo…', 'loading');
        let base64Image;
        try {
            base64Image = await fileToBase64(photoInput.files[0]);
        } catch (err) {
            setStatus('Could not read the image file. Please try again.', 'error');
            return;
        }

        requestPayload = {
            type:     'image',
            content:  base64Image,
            dishName: dishName ? dishName.value.trim() : ''
        };

    } else {
        // TEXT MODE
        const recipeTextArea = document.getElementById('recipeText');
        const recipeText     = recipeTextArea ? recipeTextArea.value.trim() : '';

        if (!recipeText) {
            setStatus('Please type or paste a recipe first.', 'error');
            return;
        }

        requestPayload = {
            type:    'text',
            content: recipeText
        };
    }

    // ── 3. Update the button and show loading state ────────
    generateBtn.textContent = '⏳ Generating your card…';
    generateBtn.disabled    = true;
    setStatus('Sending to AI… this takes about 5–10 seconds.', 'loading');

    // ── 4. Call our Netlify function ───────────────────────
    // fetch() is the standard way to make HTTP requests in JS.
    // We POST our data to our serverless function URL.
    let responseData;
    try {
        const response = await fetch('/.netlify/functions/extract-recipe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(requestPayload) // convert object → JSON string
        });

        // response.json() reads the response body as JSON
        responseData = await response.json();

        // If the response status is not 2xx, something went wrong
        if (!response.ok) {
            throw new Error(responseData.error || 'Server returned an error: ' + response.status);
        }

    } catch (fetchError) {
        // Network error, server down, etc.
        generateBtn.textContent = '✨ Generate My Recipe Card';
        generateBtn.disabled    = false;
        setStatus(
            'Could not reach the server. Are you on the live site? ' + fetchError.message,
            'error'
        );
        return;
    }

    // ── 5. Check we got a recipe back ─────────────────────
    if (!responseData.recipe) {
        generateBtn.textContent = '✨ Generate My Recipe Card';
        generateBtn.disabled    = false;
        setStatus('AI responded but recipe data was missing. Please try again.', 'error');
        return;
    }

    // ── 6. Build the card and inject it into the page ─────
    const recipe         = responseData.recipe;
    const cardHTML       = buildRecipeCard(recipe);
    const downloadCard   = document.getElementById('downloadCard');
    const generatedTitle = document.getElementById('generatedTitle');

    if (downloadCard) {
        downloadCard.innerHTML = cardHTML;
    }

    // Update the heading above the card
    if (generatedTitle) {
        generatedTitle.textContent = recipe.title || 'Your Recipe Card';
    }

    // ── 7. Show the result section ─────────────────────────
    const resultSection = document.getElementById('generatedResult');
    if (resultSection) {
        resultSection.style.display = 'block';
        // Small delay so display:block takes effect before scrolling
        setTimeout(function () { scrollTo('generatedResult'); }, 100);
    }

    // ── 8. Reset the button ────────────────────────────────
    generateBtn.textContent = '✨ Generate My Recipe Card';
    generateBtn.disabled    = false;
    setStatus('Your recipe card is ready! ↓', 'success');

    // ── 9. Enable the share button ─────────────────────────
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) {
        shareBtn.style.display = 'inline-flex';
    }
}


// ── SHARE: Copy card link / use Web Share API ──────────────
function handleShare() {
    const recipe = document.getElementById('downloadCard');
    if (!recipe) return;

    const title = recipe.querySelector('.frc-title');
    const text  = title ? 'Check out this recipe: ' + title.textContent : 'Check out this recipe card!';

    // navigator.share is the modern mobile share sheet (works on phones)
    if (navigator.share) {
        navigator.share({
            title: title ? title.textContent : 'FriendsBodega Recipe',
            text:  text,
            url:   window.location.href
        }).catch(function () { /* user cancelled — that's fine */ });
    } else {
        // Fallback: copy the page URL to clipboard
        navigator.clipboard.writeText(window.location.href).then(function () {
            const shareBtn = document.getElementById('shareBtn');
            if (shareBtn) {
                shareBtn.textContent = '✅ Link Copied!';
                setTimeout(function () {
                    shareBtn.innerHTML = '🔗 Share Card';
                }, 2000);
            }
        });
    }
}


// ── WAIT FOR THE PAGE TO FULLY LOAD ───────────────────────
// We wrap everything in DOMContentLoaded so our code only
// runs AFTER the HTML elements exist on the page.
// (If we ran it before, getElementById would return null.)
document.addEventListener('DOMContentLoaded', function () {

    // Wire up the Generate button
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        generateBtn.addEventListener('click', handleGenerate);
    }

    // Wire up the Share button
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) {
        shareBtn.addEventListener('click', handleShare);
    }

    // Wire up the Download button (uses html2canvas from CDN)
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', function () {
            const card = document.getElementById('downloadCard');
            if (!card || !card.innerHTML.trim()) {
                alert('Generate a recipe card first!');
                return;
            }

            downloadBtn.textContent = '⏳ Preparing download…';
            downloadBtn.disabled    = true;

            // Dynamically load html2canvas only when needed
            // (no point loading it if the user never clicks Download)
            const script  = document.createElement('script');
            script.src    = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            script.onload = function () {
                html2canvas(card, {
                    scale:           2,           // 2x resolution for sharp images
                    backgroundColor: '#FFF7D3',   // our soft yellow background
                    useCORS:         true,
                    logging:         false
                }).then(function (canvas) {
                    // Create a temporary <a> tag and trigger a download
                    const link     = document.createElement('a');
                    link.download  = 'FriendsBodega-RecipeCard.png';
                    link.href      = canvas.toDataURL('image/png');
                    link.click();

                    downloadBtn.textContent = '✅ Downloaded!';
                    setTimeout(function () {
                        downloadBtn.textContent = '⬇️ Download as PNG';
                        downloadBtn.disabled    = false;
                    }, 2500);
                }).catch(function (err) {
                    console.error('html2canvas error:', err);
                    downloadBtn.textContent = '⬇️ Download as PNG';
                    downloadBtn.disabled    = false;
                });
            };
            document.head.appendChild(script);
        });
    }

    console.log('✅ FriendsBodega recipe-generator.js loaded.');
});
