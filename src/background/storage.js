export const get = (keys) =>
  new Promise((resolve) => chrome.storage.local.get(keys, resolve));
export const set = (obj) =>
  new Promise((resolve) => chrome.storage.local.set(obj, resolve));
