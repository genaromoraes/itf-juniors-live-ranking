// Certify the contiguous ranking prefix, including competition-ranking ties.
// Missing players can have at most the points of the last certified rank group.
export function certifyUniverse(universe, snapshot) {
  const dates = new Set(snapshot.map(row => row.ranking_date));
  if (!snapshot.length || dates.size !== 1 || ![...dates][0]) throw new Error('Snapshot oficial sem data unica.');
  const date = [...dates][0];
  const byId = new Map(universe.map(row => [String(row.player_id), row]));
  if (byId.size !== universe.length) throw new Error('Universo com IDs duplicados.');
  if (universe.some(row => row.ranking_date !== date)) throw new Error('Universo e snapshot pertencem a datas oficiais diferentes.');
  for (const row of snapshot) {
    const other = byId.get(String(row.player_id));
    if (!other || other.gender !== row.gender || Number(other.rank) !== Number(row.rank) ||
        Number(other.official_points) !== Number(row.official_points)) {
      throw new Error(`Universo diverge do snapshot oficial para ${row.player_id}.`);
    }
  }
  const coverage = {};
  for (const gender of ['M', 'F']) {
    const rows = universe.filter(row => row.gender === gender).sort((a,b) => Number(a.rank)-Number(b.rank));
    let count = 0, bound = Infinity, groups = 0;
    for (let i = 0; i < rows.length;) {
      const rank = Number(rows[i].rank);
      if (rank !== count + 1) break;
      const points = Number(rows[i].official_points);
      if (rows[i].official_points === '' || !Number.isFinite(points) || points < 0 || points > bound) {
        throw new Error(`Pontuacao invalida no universo ${gender}.`);
      }
      let end = i + 1;
      while (end < rows.length && Number(rows[end].rank) === rank) {
        if (Number(rows[end].official_points) !== points) throw new Error('Empate oficial com pontos divergentes.');
        end++;
      }
      bound = points;
      count += end - i;
      groups++;
      i = end;
    }
    if (count < 1500 || !groups || !Number.isFinite(bound)) throw new Error(`Cobertura oficial insuficiente para ${gender}.`);
    coverage[gender] = { certified_players: count, unlisted_points_upper_bound: bound };
  }
  return { ranking_date: date, genders: coverage,
    unlisted_points_upper_bound: Math.max(...Object.values(coverage).map(row => row.unlisted_points_upper_bound)) };
}
