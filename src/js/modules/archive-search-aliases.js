// Deliberately small, unambiguous query aliases. Canonical source text is untouched.
export const SEARCH_ALIASES = Object.freeze({
  '小刻': '刻俄柏',
  '罗岛': '罗德岛',
  '傀影肉鸽': '傀影与猩红孤钻',
  '水月肉鸽': '水月与深蓝之树',
  '萨米肉鸽': '探索者的银凇止境',
  '萨卡兹肉鸽': '萨卡兹的无终奇语',
  '岁肉鸽': '岁的界园志异',
  '黑流肉鸽': '沉沦者的黑流树海',
  'ff14': '最终幻想XIV',
  'ffxiv': '最终幻想XIV',
});

export function queryGroups(query) {
  return [...new Set(String(query).normalize('NFC').replace(/"/g, '').split(/\s+/).filter(Boolean))]
    .map(term => [...new Set([term, SEARCH_ALIASES[term.toLowerCase()]].filter(Boolean))]);
}

export function aliasExplanation(query) {
  return queryGroups(query).filter(group => group.length > 1).map(([alias, name]) => `${alias} → ${name}`).join('；');
}

export function matchLocations(serializedFields, query) {
  let fields;
  try { fields = JSON.parse(serializedFields); } catch { return []; }
  if (!Array.isArray(fields)) return [];
  const terms = queryGroups(query).flat().map(term => term.toLocaleLowerCase());
  return fields.filter(field => Array.isArray(field) && typeof field[0] === 'string' && typeof field[1] === 'string'
    && terms.some(term => field[1].toLocaleLowerCase().includes(term)))
    .map(([label]) => label);
}
