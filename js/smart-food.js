(() => {
  const api = 'https://dataportal.livsmedelsverket.se/livsmedel/api/v1/livsmedel';
  const form = document.getElementById('smartFoodForm');
  const query = document.getElementById('smartFoodQuery');
  const status = document.getElementById('smartFoodStatus');
  const results = document.getElementById('smartFoodResults');
  const choices = document.getElementById('smartFoodChoices');
  const preview = document.getElementById('smartFoodPreview');
  const saveButton = document.getElementById('smartFoodSave');
  const details = document.getElementById('smartFoodDetails');
  const format = new Intl.NumberFormat('sv-SE', {maximumFractionDigits: 2});
  let catalog;
  let request;
  let portion;

  function clearSelection() {
    request?.abort();
    request = undefined;
    portion = undefined;
    preview.textContent = '';
    saveButton.disabled = true;
  }

  function resetSearch() {
    clearSelection();
    choices.replaceChildren();
    results.hidden = true;
    status.textContent = '';
  }

  async function getJson(url, signal) {
    const response = await fetch(url, {signal, credentials: 'omit'});
    if (!response.ok) throw new Error('Livsmedelsverket: ' + response.status);
    return response.json();
  }

  async function getCatalog(signal) {
    if (catalog) return catalog;
    const foods = [];
    const limit = 500;
    let offset = 0;
    let total;
    do {
      const page = await getJson(api + '?sprak=1&limit=' + limit + '&offset=' + offset, signal);
      total = page._meta?.totalRecords;
      if (!Number.isSafeInteger(total) || total < 1 || !Array.isArray(page.livsmedel) ||
          !page.livsmedel.length || page._meta.offset !== offset ||
          offset + page.livsmedel.length > total) {
        throw new Error('Ofullständig livsmedelslista');
      }
      for (const {nummer, namn} of page.livsmedel) {
        if (!Number.isSafeInteger(nummer) || typeof namn !== 'string' || !namn.trim()) {
          throw new Error('Ogiltigt livsmedel');
        }
        foods.push({nummer, namn, words: words(namn)});
      }
      offset += page.livsmedel.length;
    } while (offset < total);
    return catalog = foods;
  }

  function parseQuery(text) {
    const match = text.trim().match(/^(.+?)\s+(\d+(?:[,.]\d{1,2})?)\s*(?:gram|g)$/i);
    const grams = match ? Number(match[2].replace(',', '.')) : 0;
    if (!match || !/\p{L}/u.test(match[1]) || /\d\s*(?:gram|g)\b/i.test(match[1]) ||
        grams <= 0 || grams > 10000) return null;
    return {name: match[1], grams};
  }

  function words(name) {
    return name.toLocaleLowerCase('sv-SE').replace(/kyckling\s*(?:bröst)?fil[ée]/g, 'kyckling bröstfilé')
      .normalize('NFD').replace(/\p{Diacritic}/gu, '').match(/[a-z0-9]+/g) || [];
  }

  function findFoods(foods, name) {
    const terms = words(name);
    if (!terms.length) return [];
    return foods.filter(food => terms.every(term => food.words.includes(term)))
      .sort((a, b) => Number(b.words[0] === terms[0]) - Number(a.words[0] === terms[0]) ||
        a.words.length - b.words.length || a.namn.localeCompare(b.namn, 'sv-SE'));
  }

  function nutrient(values, code, unit) {
    const row = values.find(item => item.euroFIRkod === code && item.enhet === unit &&
      item.viktGram === 100 && item.matrisenhetkod === 'W');
    return Number.isFinite(row?.varde) && row.varde >= 0 ? row.varde : undefined;
  }

  async function load(message, task) {
    const controller = new AbortController();
    request = controller;
    status.textContent = message;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      await task(controller);
    } catch {
      if (request === controller) {
        status.textContent = 'Kunde inte hämta data från Livsmedelsverket. Kontrollera anslutningen och försök igen, eller registrera manuellt.';
      }
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = undefined;
    }
  }

  async function select(food, grams) {
    clearSelection();
    await load('Hämtar näringsvärden …', async controller => {
      const values = await getJson(api + '/' + food.nummer + '/naringsvarden?sprak=1', controller.signal);
      if (request !== controller) return;
      const kcal = nutrient(values, 'ENERC', 'kcal');
      const protein = nutrient(values, 'PROT', 'g');
      if (kcal === undefined || protein === undefined) {
        status.textContent = 'Kalorier eller protein saknas för detta livsmedel. Välj en annan träff eller registrera manuellt.';
        return;
      }
      portion = {
        kind: 'food',
        name: food.namn + ' (' + format.format(grams) + ' g)',
        kcal: Math.round(kcal * grams / 100),
        protein: Math.round(protein * grams / 10) / 10
      };
      preview.textContent = portion.name + ': ' + format.format(portion.kcal) +
        ' kcal · ' + format.format(portion.protein) + ' g protein';
      status.textContent = '';
      saveButton.disabled = false;
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    resetSearch();
    const parsed = parseQuery(query.value);
    if (!parsed) {
      status.textContent = 'Ange ett livsmedel och en mängd över 0 och högst 10 000 g, med upp till två decimaler. Exempel: Ägg 120 g.';
      return;
    }
    await load('Söker i Livsmedelsverkets databas …', async controller => {
      const foods = await getCatalog(controller.signal);
      if (request !== controller) return;
      const matches = findFoods(foods, parsed.name);
      if (!matches.length) {
        status.textContent = 'Ingen träff. Prova ett annat namn eller registrera maten manuellt.';
        return;
      }
      const placeholder = new Option('Välj livsmedel', '', true, true);
      placeholder.disabled = true;
      choices.add(placeholder);
      for (const [index, food] of matches.entries()) choices.add(new Option(food.namn, index));
      choices.onchange = () => select(matches[Number(choices.value)], parsed.grams);
      results.hidden = false;
      status.textContent = matches.length + ' träffar. Välj det livsmedel som passar din portion.';
    });
  });
  query.addEventListener('input', resetSearch);
  saveButton.addEventListener('click', () => {
    if (!portion) return;
    const entry = {id: Date.now() + Math.random(), date: day.value, ...portion};
    const updated = {...db, entries: [...db.entries, entry]};
    try {
      localStorage.setItem(KEY, JSON.stringify(updated));
    } catch {
      status.textContent = 'Kunde inte spara portionen. Kontrollera lagringsutrymmet och försök igen.';
      return;
    }
    db = updated;
    render();
    clearSelection();
    foodDialog.close();
  });
  foodDialog.addEventListener('close', () => {
    form.reset();
    details.open = false;
    resetSearch();
  });
})();
