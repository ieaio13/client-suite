import { createContext, useContext } from 'react';

// Everything loaded from the server (the "boot" payload) plus helpers to change it.
// data: the boot payload · refresh(): refetch · patch(fn): local optimistic edit
export const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

// Small helpers for optimistic updates on the boot payload.
export function upsert(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return list.concat([item]);
  const next = list.slice();
  next[i] = { ...list[i], ...item };
  return next;
}
export function remove(list, id) {
  return list.filter((x) => x.id !== id);
}
