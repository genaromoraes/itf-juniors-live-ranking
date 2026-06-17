const fs = require("fs/promises");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

async function readCsv(filePath) {
  const csv = await fs.readFile(filePath, "utf8");

  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });
}

async function writeCsv(filePath, rows, columns) {
  const csv = stringify(rows, {
    header: true,
    columns,
  });

  await fs.writeFile(filePath, csv, "utf8");
}

module.exports = {
  readCsv,
  writeCsv,
};
