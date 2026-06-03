import fs from "fs";

const file = "scripts/09_generate_live_ranking_html.mjs";

let text = fs.readFileSync(file, "utf8");

const replacements = [
  ["Info TÃªnis Brasil", "Info Tênis Brasil"],
  ["PortuguÃªs", "Português"],
  ["Ãšltima atualizaÃ§Ã£o", "Última atualização"],
  ["Ãšltima atualizaÃÂ§ÃÂ£o", "Última atualização"],
  ["Ãºltima atualizaÃ§Ã£o", "última atualização"],
  ["PrÃ³x. Rodada", "Próx. Rodada"],
  ["PrÃ³x. rodada", "Próx. rodada"],
  ["PrÃ³x.", "Próx."],
  ["PontuaÃ§Ãµes", "Pontuações"],
  ["PontuaÃ§Ã£o", "Pontuação"],
  ["PontuaÃÃ§ÃÃµes", "Pontuações"],
  ["pontuaÃ§Ã£o", "pontuação"],
  ["pontuaÃÃ§ÃÃ£o", "pontuação"],
  ["TÃ­tulo", "Título"],
  ["tÃ­tulo", "título"],
  ["mÃ¡ximo", "máximo"],
  ["MÃ¡ximo", "Máximo"],
  ["paÃ­s", "país"],
  ["PaÃ­s", "País"],
  ["paÃÂ­s", "país"],
  ["Nome, paÃ­s ou torneio", "Nome, país ou torneio"],
  ["Nome, paÃÂ­s ou torneio", "Nome, país ou torneio"],
  ["Buscar atleta", "Buscar atleta"],
  ["AtualizaÃ§Ã£o", "Atualização"],
  ["atualizaÃ§Ã£o", "atualização"],
  ["atualizaÃÃ§ÃÃ£o", "atualização"],
  ["Categoria", "Categoria"],
  ["Ordenar por", "Ordenar por"],
  ["Ranking ao vivo", "Ranking ao vivo"],
  ["Pontos = âˆ‘ 6 melhores resultados de simples + âˆ‘ 25% dos 6 melhores resultados de duplas", "Pontos = ∑ 6 melhores resultados de simples + ∑ 25% dos 6 melhores resultados de duplas"],
  ["Pontos = âˆ‘", "Pontos = ∑"],
  [" + âˆ‘ ", " + ∑ "],
  ["Â·", "·"],
  ["â€“", "–"],
  ["â€”", "—"],
  ["Ã¡", "á"],
  ["Ãà", "à"],
  ["Ã¢", "â"],
  ["Ã£", "ã"],
  ["Ã©", "é"],
  ["Ãª", "ê"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ã´", "ô"],
  ["Ãµ", "õ"],
  ["Ãº", "ú"],
  ["Ã§", "ç"],
  ["Ã", "ã"]
];

for (const [bad, good] of replacements) {
  text = text.split(bad).join(good);
}

fs.writeFileSync(file, text, "utf8");

console.log("Arquivo corrigido:", file);
