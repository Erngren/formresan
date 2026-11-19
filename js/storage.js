(() => {
  'use strict';

  const MAIN_KEY = 'formresan_v1';
  const TRAINING_KEY = 'formresan_training_v14';
  const LOCK_NAME = 'formresan-local-data-v1';
  const observed = new Set();
  const pending = new WeakSet();
  const copy = value => JSON.parse(JSON.stringify(value));
  const emptyMain = () => ({goals: {protein: 120, cal: 0}, entries: []});
  const emptyTraining = () => ({sessions: []});
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const text = value => typeof value === 'string';

  function requireValue(valid, message) {
    if (!valid) throw new Error(message);
  }

  function validDate(value) {
    if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function validateRecords(records, label) {
    requireValue(Array.isArray(records), label + ' måste vara en lista.');
    const ids = new Set();
    for (const record of records) {
      requireValue(object(record), label + ' innehåller en ogiltig post.');
      requireValue(number(record.id) && record.id > 0 && record.id <= Number.MAX_SAFE_INTEGER,
        label + ' innehåller ett ogiltigt ID. ID måste vara ett positivt tal.');
      requireValue(!ids.has(record.id), label + ' innehåller dubbla ID:n.');
      ids.add(record.id);
      requireValue(validDate(record.date), label + ' innehåller ett ogiltigt datum. Använd ÅÅÅÅ-MM-DD.');
    }
  }

  function validateMain(value) {
    requireValue(object(value) && object(value.goals), 'Filen måste innehålla mål och huvudappens poster.');
    requireValue(number(value.goals.protein) && value.goals.protein > 0, 'Proteinmålet måste vara ett positivt tal.');
    requireValue(value.goals.cal === undefined || number(value.goals.cal), 'Energimålet måste vara ett tal från noll.');
    validateRecords(value.entries, 'Historiken');
    const result = copy(value);
    result.goals.cal ??= 0;
    for (const entry of result.entries) {
      switch (entry.kind) {
        case 'food':
          requireValue(text(entry.name) && entry.name.trim() && number(entry.kcal) && number(entry.protein),
            'En matpost saknar giltigt namn, kalorier eller protein.');
          break;
        case 'work':
          requireValue(text(entry.type) && entry.type.trim(), 'En träningspost saknar typ.');
          if (entry.notes === undefined) entry.notes = '';
          requireValue(text(entry.notes), 'Träningsanteckningen måste vara text.');
          for (const field of ['minutes', 'km', 'burn']) {
            if (entry[field] === undefined) entry[field] = 0;
            requireValue(number(entry[field]), 'Tid, distans och energi måste vara tal från noll.');
          }
          break;
        case 'weight':
          requireValue(number(entry.kg) && entry.kg > 0, 'En viktpost innehåller en ogiltig vikt.');
          break;
        case 'sleep':
          requireValue(number(entry.minutes) && entry.minutes > 0 && entry.minutes <= 1440,
            'En sömnpost innehåller en ogiltig sömntid.');
          if (entry.feel === undefined) entry.feel = '';
          requireValue(text(entry.feel), 'Sömnens beskrivning måste vara text.');
          break;
        case 'creatine':
          break;
        default:
          throw new Error('Historiken innehåller en posttyp som appen inte känner igen.');
      }
    }
    return result;
  }

  function validateTraining(value) {
    requireValue(object(value), 'Träningsdata måste vara ett objekt.');
    validateRecords(value.sessions, 'Träningshistoriken');
    for (const session of value.sessions) {
      requireValue(text(session.plan) && session.plan.trim() && Array.isArray(session.exercises),
        'Ett träningspass saknar plan eller övningslista.');
      for (const exercise of session.exercises) {
        requireValue(object(exercise) && text(exercise.id) && exercise.id.trim(), 'En övning saknar giltigt ID.');
        if (exercise.sets !== undefined) {
          requireValue(Array.isArray(exercise.sets), 'Övningens set måste vara en lista.');
          for (const set of exercise.sets) {
            requireValue(object(set) && number(set.kg) && Number.isInteger(set.reps) && set.reps >= 1 && set.reps <= 100,
              'Ett set innehåller ogiltig vikt eller repetitioner.');
          }
        } else {
          requireValue(exercise.done === true, 'En rutinövning saknar markering för genomförd övning.');
        }
      }
    }
    return copy(value);
  }

  function raw(key) {
    let value;
    try {
      value = localStorage.getItem(key);
    } catch {
      throw new Error('Lagringen kunde inte läsas. Ingen data har ändrats. Kontrollera webbläsarens lagringsinställningar.');
    }
    if (value !== null) observed.add(key);
    if (value === null && observed.has(key)) {
      throw new Error('Tidigare lagrade data saknas nu. Sparningen stoppades. Exportera en råkopia och kontrollera andra öppna flikar.');
    }
    return value;
  }

  function parse(rawValue) {
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new Error('Lagringen innehåller ogiltig JSON. Ingen data har ändrats. Exportera en råkopia för återställning.');
    }
  }

  function read(key, validate, empty) {
    const value = raw(key);
    return value === null ? empty() : validate(parse(value));
  }

  function locked(task) {
    if (!navigator.locks?.request) {
      return Promise.reject(new Error('Säker sparning kräver en webbläsare med Web Locks. Uppdatera Safari eller använd en aktuell webbläsare. Du kan fortfarande exportera dina data.'));
    }
    return navigator.locks.request(LOCK_NAME, {mode: 'exclusive'}, task);
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      observed.add(key);
      document.getElementById('storageNotice')?.remove();
    } catch {
      throw new Error('Kunde inte spara lokalt. Inmatningen finns kvar. Kontrollera lagringsutrymmet och försök igen.');
    }
  }

  function update(key, validate, empty, change) {
    return locked(() => {
      // Re-read inside the shared lock. Never write a page's old in-memory snapshot.
      const next = read(key, validate, empty);
      change(next);
      const validated = validate(next);
      write(key, validated);
      return validated;
    });
  }

  function nextId(records) {
    const ids = new Set(records.map(record => record.id));
    let id = Date.now();
    while (ids.has(id)) id += 1;
    return id;
  }

  function report(error) {
    const message = error instanceof Error ? error.message : 'Kunde inte spara. Försök igen.';
    let notice = document.getElementById('storageNotice');
    const repeated = notice?.textContent === message;
    if (!notice) {
      notice = document.createElement('p');
      notice.id = 'storageNotice';
      notice.className = 'help';
      notice.setAttribute('role', 'alert');
      document.querySelector('main').prepend(notice);
    }
    notice.textContent = message;
    if (!repeated) alert(message);
  }

  async function run(container, task) {
    if (pending.has(container)) return false;
    pending.add(container);
    const controls = container.matches('button, input, select') ? [container] : [...container.querySelectorAll('input, select, button')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
      await task();
      return true;
    } catch (error) {
      report(error);
      return false;
    } finally {
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      pending.delete(container);
    }
  }

  function download(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportAll() {
    // Capture both keys in the same lock, including untouched raw strings for recovery.
    const capture = () => {
      const data = {}, rawData = {}, errors = {};
      for (const key of [MAIN_KEY, TRAINING_KEY]) {
        // A raw backup must also work when a previously observed key has gone missing.
        let value;
        try { value = localStorage.getItem(key); } catch {
          throw new Error('Säkerhetskopian kunde inte läsa lagringen. Ingen ofullständig fil har skapats.');
        }
        rawData[key] = value;
        data[key] = null;
        if (value !== null) {
          try { data[key] = JSON.parse(value); } catch { errors[key] = 'Ogiltig JSON. Råsträngen finns i rawData.'; }
        }
      }
      return {format: 'formresan-backup', formatVersion: 1, exportedAt: new Date().toISOString(), data, rawData, errors};
    };
    try {
      const backup = await locked(capture);
      download(backup, 'formresan-komplett-' + backup.exportedAt.slice(0, 10) + '.json');
    } catch (error) { report(error); }
  }

  window.FormresanStorage = {
    MAIN_KEY, TRAINING_KEY, emptyMain, emptyTraining, validateMain, nextId, raw, report, run, download, exportAll,
    readMain: () => read(MAIN_KEY, validateMain, emptyMain),
    readTraining: () => read(TRAINING_KEY, validateTraining, emptyTraining),
    updateMain: change => update(MAIN_KEY, validateMain, emptyMain, change),
    updateTraining: change => update(TRAINING_KEY, validateTraining, emptyTraining, change),
    replaceMain: (value, expectedRaw) => locked(() => {
      requireValue(raw(MAIN_KEY) === expectedRaw, 'Data ändrades i en annan flik. Importen avbröts. Granska filen och försök igen.');
      read(MAIN_KEY, validateMain, emptyMain);
      const validated = validateMain(value);
      write(MAIN_KEY, validated);
      return validated;
    }),
    // Each legacy export reads one complete, atomically stored value and needs no write lock.
    exportMain: () => Promise.resolve().then(() => read(MAIN_KEY, validateMain, emptyMain)),
    exportTraining: () => Promise.resolve().then(() => read(TRAINING_KEY, validateTraining, emptyTraining))
  };
})();
