// Markdown (GFM) tables as text: the rows and cells of a table with their
// offsets in its source, and the edits live mode's table toolbar makes.
// Cells are split at unescaped pipes, as GFM does.
(function (MDE) {
    const NEW_CELL = '   |';

    // Offsets of the unescaped pipes in a line
    function pipesOf(line) {
        const out = [];
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '\\') i++;
            else if (line[i] === '|') out.push(i);
        }
        return out;
    }

    // The cells of one line. A cell's text is what lies between its pipes
    // less one space of padding on each side, so spaces typed at its ends
    // are kept; an empty cell's text sits one space in from its left pipe.
    // start and end are the offsets of its raw text (end: its right pipe).
    function splitRow(line) {
        const first = line.search(/\S/);
        if (first === -1) return { cells: [], trail: false };
        const last = line.trimEnd().length - 1;
        const edges = pipesOf(line);
        const lead = edges[0] === first;
        const trail = edges.length > (lead ? 1 : 0) && edges[edges.length - 1] === last;
        if (!lead) edges.unshift(first - 1);
        if (!trail) edges.push(last + 1);
        const cells = [];
        for (let k = 0; k + 1 < edges.length; k++) {
            const a = edges[k] + 1;
            const z = edges[k + 1];
            const raw = line.slice(a, z);
            let from = a + Math.min(1, z - a);
            let to = from;
            if (raw.trim()) {
                from = a + (/^\s/.test(raw) ? 1 : 0);
                to = z - (/\s$/.test(raw) && z - 1 > from ? 1 : 0);
            }
            cells.push({ from, to, text: line.slice(from, to), start: a, end: z });
        }
        return { cells, trail };
    }

    function alignOf(text) {
        const left = text.startsWith(':');
        const right = text.endsWith(':') && text.length > 1;
        return left && right ? 'center' : left ? 'left' : right ? 'right' : null;
    }

    // rows[0] is the header and rows[1…] the body; the delimiter line is
    // kept apart. Offsets are from the start of the source.
    function parse(source) {
        const lines = source.split('\n');
        const rows = [];
        let delimiter = null;
        let offset = 0;
        lines.forEach((line, i) => {
            const cells = splitRow(line).cells.map((c) => ({ from: offset + c.from, to: offset + c.to, text: c.text, start: offset + c.start, end: offset + c.end }));
            const row = { line: i, from: offset, to: offset + line.length, cells };
            if (i === 1) delimiter = row;
            else rows.push(row);
            offset += line.length + 1;
        });
        const align = delimiter ? delimiter.cells.map((c) => alignOf(c.text.trim())) : [];
        return { rows, delimiter, align, cols: align.length };
    }

    // A line with at least `count` cells and a closing pipe
    function padRow(line, count) {
        let { cells, trail } = splitRow(line);
        if (!cells.length) return '|' + NEW_CELL.repeat(count);
        if (!trail) {
            line = line.trimEnd() + ' |';
            ({ cells } = splitRow(line));
        }
        return cells.length < count ? line + NEW_CELL.repeat(count - cells.length) : line;
    }

    function setAlign(source, col, align) {
        const lines = source.split('\n');
        const cell = lines.length > 1 && splitRow(lines[1]).cells[col];
        if (!cell) return source;
        const dashes = '-'.repeat(Math.max(1, (cell.text.match(/-/g) || []).length));
        const pad = (str) => cell.text.match(/^\s*/)[0] + str + cell.text.match(/\s*$/)[0];
        const text = align === 'center' ? `:${dashes}:` : align === 'left' ? `:${dashes}` : align === 'right' ? `${dashes}:` : dashes;
        lines[1] = lines[1].slice(0, cell.from) + pad(text) + lines[1].slice(cell.to);
        return lines.join('\n');
    }

    // An empty row after rows[row] (0: the header, so it becomes the first
    // body row). rows[k] is line k + 1 for k >= 1: line 1 is the delimiter.
    function insertRow(source, row, cols) {
        const lines = source.split('\n');
        const at = row + 2;
        lines.splice(Math.min(at, lines.length), 0, '|' + NEW_CELL.repeat(cols));
        return lines.join('\n');
    }

    // An empty column after column `col`, in every line
    function insertColumn(source, col) {
        return source.split('\n').map((line, i) => {
            if (!line.trim()) return line;
            const padded = padRow(line, col + 1);
            const cell = splitRow(padded).cells[col];
            const insert = i === 1 ? (padded[cell.end - 1] === ' ' ? ' --- |' : '---|') : NEW_CELL;
            return padded.slice(0, cell.end + 1) + insert + padded.slice(cell.end + 1);
        }).join('\n');
    }

    // Without rows[row] (a body row: row >= 1)
    function deleteRow(source, row) {
        const lines = source.split('\n');
        lines.splice(row + 1, 1);
        return lines.join('\n');
    }

    // Without column `col`, in every line that has it. A line without
    // pipes at its ends gets them first, so a table left with one column
    // is still a table.
    function deleteColumn(source, col) {
        return source.split('\n').map((line) => {
            const { cells } = splitRow(line);
            if (!cells[col]) return line;
            // (a short row whose only cell goes keeps an empty one)
            if (cells.length === 1) return line.slice(0, line.search(/\S/)) + '|' + NEW_CELL;
            const first = line.search(/\S/);
            if (line[first] !== '|') line = line.slice(0, first) + '| ' + line.slice(first);
            if (!splitRow(line).trail) line = line.trimEnd() + ' |';
            const cell = splitRow(line).cells[col];
            return line.slice(0, cell.start) + line.slice(cell.end + 1);
        }).join('\n');
    }

    // Text typed or pasted into a cell: one line, pipes escaped
    function escapeCell(text) {
        return text.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|');
    }

    MDE.table = { parse, padRow, setAlign, insertRow, insertColumn, deleteRow, deleteColumn, escapeCell };
})(window.MDE = window.MDE || {});
