// Small pattern optimizer: recognizes op->move->freeTemp pattern and rewrites op to write directly
class IC10PatternOptimizer {
	constructor() {
		// opcodes we consider safe to change destination for
		this.safeOps = new Set([
					'move', 'select',
					'add', 'sub', 'mul', 'div', 'mod',
					'max', 'min',
					'seq', 'sne', 'slt', 'sle', 'sgt', 'sge',
					'bge',
					'abs', 'ceil', 'exp', 'floor', 'log', 'pow', 'random', 'round', 'sqrt', 'trunc',
					'acos', 'asin', 'atan', 'atan2', 'cos', 'sin', 'tan'
				]);
		// how many lines back to look for the pattern
		this.lookback = 6;
	}

	/**
	 * Try to optimize when freeing a temp register 'reg'.
	 * codeArr is compiler.code (array of emitted lines).
	 * If optimized, edits codeArr in-place and returns true.
	 */
	tryOptimizeOnFree(codeArr, reg) {
		if (!reg || typeof reg !== 'string')
			return false;
		// quick check: reg should be of form r\d+
		if (!/^r\d+$/.test(reg))
			return false;

		// last meaningful line should be the move that copies reg into a var.
		// Find last non-empty (and non-comment/label) line index
		let lastIdx = codeArr.length - 1;
		while (lastIdx >= 0 && /^\s*$/.test(codeArr[lastIdx]))
			lastIdx--;
		if (lastIdx < 0)
			return false;

		const lastLine = codeArr[lastIdx].trim();

		// we expect lastLine to be "move <dest> <reg>"
		const mvMatch = /^\s*move\s+(\S+)\s+(\S+)\s*$/.exec(lastLine);
		if (!mvMatch)
			return false;
		const dest = mvMatch[1];
		const src = mvMatch[2];
		if (src !== reg)
			return false;

		// dest must be a register (rN) where writing result directly is valid.
		if (!/^r\d+$/.test(dest))
			return false;

		// find previous meaningful line (skip labels/comments/blank)
		let prevIdx = lastIdx - 1;
		let searched = 0;
		while (prevIdx >= 0 && searched < this.lookback) {
			const l = codeArr[prevIdx].trim();
			if (l === '' || /^[A-Za-z_]\w*:$/.test(l)) {
				// if label encountered before op, abort optimization (unsafe)
				if (/^[A-Za-z_]\w*:$/.test(l))
					return false;
				prevIdx--;
				searched++;
				continue;
			}
			// parse previous line as tokens
			const parts = l.split(/\s+/).filter(Boolean);
			if (parts.length >= 2) {
				const op = parts[0];
				const opDest = parts[1];
				// if opDest equals the temp we're freeing, and op is safe, we can replace it
				if (opDest === reg && this.safeOps.has(op.toLowerCase())) {
					// Replace destination with dest register (from move)
					parts[1] = dest;
					codeArr[prevIdx] = parts.join(' ');
					// Remove the move line
					codeArr.splice(lastIdx, 1);
					return true;
				}
			}
			// if not matched, we won't look further (conservative)
			return false;
		}
		return false;
	}

	tryRemoveDeadMove(codeArr, reg) {
		if (!reg || typeof reg !== 'string')
			return false;
		if (!/^r\d+$/.test(reg))
			return false;

		// search backward for a "move <reg> <src>" within lookback lines
		const endIdx = codeArr.length - 1;
		const startIdx = Math.max(0, endIdx - this.lookback);
		let foundIdx = -1;
		for (let i = endIdx; i >= startIdx; i--) {
			const line = (codeArr[i] || '').trim();
			if (!line)
				continue;
			// abort if label encountered (conservative)
			if (/^[A-Za-z_]\w*:$/.test(line))
				return false;
			const mv = /^\s*move\s+(\S+)\s+(\S+)\s*$/.exec(line);
			if (mv && mv[1] === reg) {
				foundIdx = i;
				break;
			}
		}
		if (foundIdx === -1)
			return false;

		// ensure 'reg' is not referenced in any line AFTER the move (until end)
		const re = new RegExp('\\b' + reg + '\\b');
		for (let j = foundIdx + 1; j <= endIdx; j++) {
			const l = codeArr[j] || '';
			if (re.test(l)) {
				// referenced later — can't remove
				return false;
			}
			// if we hit a label before end, be conservative and abort
			if (/^[A-Za-z_]\w*:$/.test((l || '').trim()))
				return false;
		}

		// safe to remove the redundant move
		codeArr.splice(foundIdx, 1);
		return true;
	}
}
