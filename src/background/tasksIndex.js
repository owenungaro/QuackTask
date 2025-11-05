import { listTaskLists, listTasksForList } from "./tasksApi.js";

export async function buildIndex(token) {
  const lists = await listTaskLists(token);
  const activeTitles = Object.create(null);
  const activeNotes = Object.create(null);
  const completedTitles = Object.create(null);
  const completedNotes = Object.create(null);

  for (const l of lists) {
    const items = await listTasksForList(l.id, token);
    for (const t of items) {
      if (!t.title) continue;
      const title = t.title.trim();
      const notes = (t.notes || "").trim();
      const dst =
        t.status === "completed"
          ? [completedTitles, completedNotes]
          : [activeTitles, activeNotes];
      dst[0][title] = { listId: l.id, id: t.id };
      if (notes) dst[1][notes] = { listId: l.id, id: t.id };
    }
  }
  return { lists, activeTitles, activeNotes, completedTitles, completedNotes };
}

export async function findByTitle(token, title) {
  const idx = await buildIndex(token);
  return idx.activeTitles[title] || idx.completedTitles[title] || null;
}
