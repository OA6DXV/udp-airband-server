'use strict';

function normalizeSections(sections) {
  if (!Array.isArray(sections)) throw new Error('Sections must be an array.');
  const ids = new Set();
  const names = new Set();

  return sections.map((section) => {
    const id = String(section && section.id || '').trim();
    const name = String(section && section.name || '').trim();
    const nameKey = name.toLocaleLowerCase();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) {
      throw new Error('Each section needs a valid ID.');
    }
    if (!name || name.length > 80) throw new Error('Section names must contain 1 to 80 characters.');
    if (ids.has(id)) throw new Error(`Duplicate section ID "${id}".`);
    if (names.has(nameKey)) throw new Error(`Duplicate section name "${name}".`);
    ids.add(id);
    names.add(nameKey);
    return { id, name };
  });
}

module.exports = {
  normalizeSections,
};
