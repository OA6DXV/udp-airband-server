'use strict';

function createSqliteStreamLayout({ database }) {
  const { db, transaction } = database;
  const sectionRows = db.prepare(`
    SELECT id, name, sort_order
    FROM stream_sections
    ORDER BY sort_order, name COLLATE NOCASE
  `);
  const layoutRows = db.prepare(`
    SELECT stream_name, sort_order, section_id
    FROM stream_layout
    ORDER BY sort_order, stream_name COLLATE NOCASE
  `);
  const deleteLayouts = db.prepare('DELETE FROM stream_layout');
  const deleteSections = db.prepare('DELETE FROM stream_sections');
  const insertSection = db.prepare('INSERT INTO stream_sections (id, name, sort_order) VALUES (?, ?, ?)');
  const insertLayout = db.prepare('INSERT INTO stream_layout (stream_name, sort_order, section_id) VALUES (?, ?, ?)');

  function snapshot() {
    return {
      sections: sectionRows.all().map((row) => ({
        id: String(row.id),
        name: String(row.name),
      })),
      streams: layoutRows.all().map((row) => ({
        streamName: String(row.stream_name),
        sectionId: row.section_id === null ? '' : String(row.section_id),
      })),
    };
  }

  function replace(sections, streams) {
    const normalizedSections = normalizeSections(sections);
    const sectionIds = new Set(normalizedSections.map((section) => section.id));
    const normalizedStreams = normalizeStreams(streams, sectionIds);

    transaction(() => {
      deleteLayouts.run();
      deleteSections.run();
      for (const [sortOrder, section] of normalizedSections.entries()) {
        insertSection.run(section.id, section.name, sortOrder);
      }
      for (const [sortOrder, stream] of normalizedStreams.entries()) {
        insertLayout.run(stream.streamName, sortOrder, stream.sectionId || null);
      }
    });
    return snapshot();
  }

  function restore(value) {
    const sections = Array.isArray(value && value.sections) ? value.sections : [];
    const streams = Array.isArray(value && value.streams) ? value.streams : [];
    return replace(sections, streams);
  }

  function apply(streams) {
    const saved = snapshot();
    const savedByName = new Map(saved.streams.map((stream, index) => [stream.streamName, { ...stream, sortOrder: index }]));
    const sections = new Map(saved.sections.map((section) => [section.id, section]));
    const nextOrder = saved.streams.length;

    const ordered = streams.map((stream, index) => {
      const preference = savedByName.get(stream.name);
      return {
        ...stream,
        sectionId: preference && sections.has(preference.sectionId) ? preference.sectionId : '',
        sortOrder: preference ? preference.sortOrder : nextOrder + index,
        configOrder: index,
      };
    }).sort((left, right) => left.sortOrder - right.sortOrder || left.configOrder - right.configOrder)
      .map(({ configOrder, ...stream }) => stream);

    return { sections: saved.sections, streams: ordered };
  }

  return {
    apply,
    replace,
    restore,
    snapshot,
  };
}

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

function normalizeStreams(streams, sectionIds) {
  if (!Array.isArray(streams)) throw new Error('Stream layout must be an array.');
  const names = new Set();

  return streams.map((stream) => {
    const streamName = String(stream && stream.streamName || '').trim();
    const sectionId = String(stream && stream.sectionId || '').trim();
    if (!streamName) throw new Error('Each stream needs a route name.');
    if (names.has(streamName)) throw new Error(`Duplicate stream layout for "${streamName}".`);
    if (sectionId && !sectionIds.has(sectionId)) throw new Error(`Unknown section ID "${sectionId}".`);
    names.add(streamName);
    return { streamName, sectionId };
  });
}

module.exports = {
  createSqliteStreamLayout,
};
