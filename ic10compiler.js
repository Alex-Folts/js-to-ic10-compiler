// ---- Improved IC10Compiler (register reuse) ----
// ---------- IC10Compiler (namespace-aware call handlers) ----------
class IC10Compiler {
	constructor() {
		this.code = [];
		this.varReg = new Map();
		this.nextVarReg = 0; // r0..r7 for vars
		this.nextTempReg = 8; // r8..r15 for temps
		this.maxReg = 15;

		this.tempPool = [];
		this.tempInUse = new Set();

		this._labelCounter = 1;

		this.consts = new Map();
		this.preamble = [];

		// map: namespace -> Map(name->handler)
		this.callHandlers = new Map();

		// stacks for break/continue label targets (support nested constructs)
		this.breakStack = [];
		this.continueStack = [];
	}

	// -------------------------------------------------------------------
	// registerCallHandler supports two forms:
	//  - registerCallHandler(namespace, name, fn)
	//  - registerCallHandler(name, fn)  <-- legacy: registers under "IC10" namespace
	// -------------------------------------------------------------------
	registerCallHandler(namespaceOrName, nameOrFn, maybeFn) {
		let namespace,
		name,
		fn;
		if (maybeFn !== undefined) {
			// 3-arg form
			namespace = namespaceOrName;
			name = nameOrFn;
			fn = maybeFn;
		} else {
			// 2-arg legacy form: treat as IC10.<name>
			namespace = 'IC10';
			name = namespaceOrName;
			fn = nameOrFn;
		}
		if (!this.callHandlers.has(namespace))
			this.callHandlers.set(namespace, new Map());
		this.callHandlers.get(namespace).set(name, fn);
	}

	// helper: find handler by namespace and name. tries parent namespaces if exact not found.
	_findHandlerFor(namespace, name) {
		// try exact then walk up (e.g. try "IC10.utils", then "IC10")
		let ns = namespace;
		while (true) {
			const m = this.callHandlers.get(ns);
			if (m && m.has(name))
				return m.get(name);
			const dot = ns.lastIndexOf('.');
			if (dot === -1)
				break;
			ns = ns.slice(0, dot);
		}
		// finally try top-level exact namespace
		const top = this.callHandlers.get(ns);
		if (top && top.has(name))
			return top.get(name);
		// also try empty namespace '' if present
		const empty = this.callHandlers.get('');
		if (empty && empty.has(name))
			return empty.get(name);
		return null;
	}

	// -------------------------------------------------------------------
	emit(line) {
		this.code.push(line);
	}
	newTemp() {
		if (this.tempPool.length > 0) {
			const r = this.tempPool.pop();
			this.tempInUse.add(r);
			return r;
		}
		if (this.nextTempReg > this.maxReg)
			throw new Error('Out of temp registers (r8..r15 exhausted)');
		const r = 'r' + (this.nextTempReg++);
		this.tempInUse.add(r);
		return r;
	}
	freeTemp(reg) {
		if (!reg)
			return;
		if (!this.isTempReg(reg))
			return;
		if (!this.tempInUse.has(reg))
			return;
		this.tempInUse.delete(reg);
		this.tempPool.push(reg);
	}
	isTempReg(r) {
		if (!r || typeof r !== 'string')
			return false;
		const m = /^r(\d+)$/.exec(r);
		if (!m)
			return false;
		const n = Number(m[1]);
		return n >= 8 && n <= this.maxReg;
	}
	allocVar(name) {
		if (this.varReg.has(name))
			return this.varReg.get(name);
		if (this.nextVarReg > 7) {
			if (this.nextVarReg > this.maxReg)
				throw new Error('Out of registers for variables');
		}
		const reg = 'r' + (this.nextVarReg++);
		this.varReg.set(name, reg);
		return reg;
	}
	newLabel(prefix = 'L') {
		return `${prefix}${this._labelCounter++}`;
	}

	// -------------------------------------------------------------------
	compileProgram(ast) {
		this.code = [];
		this.preamble = [];
		this.consts = new Map();
		this.breakStack = [];
		this.continueStack = [];
		this.traverseStatements(ast.body);
		const pre = this.preamble.join('\n');
		const body = this.code.join('\n');
		return (pre ? pre + '\n' : '') + body;
	}
	traverseStatements(list) {
		for (const s of list)
			this.compileStatement(s);
	}

	// ---------------- statements ------------------------
	compileStatement(node) {
		if (!node)
			return;
		switch (node.type) {
		case 'VariableDeclaration':
			for (const d of node.declarations) {
				const name = d.id.name;
				if (node.kind === 'const') {
					if (!d.init)
						throw new Error(`const ${name} must have an initializer`);
					if (d.init.type === 'Literal') {
						const num = this.convertJsValueToNumber(d.init.value, `const ${name}`);
						this.consts.set(name, num);
						this.preamble.push(`define ${name} ${num}`);
					} else {
						throw new Error(`const ${name} must be initialized with a literal`);
					}
				} else {
					const dest = this.allocVar(name);
					if (d.init) {
						const src = this.compileExpressionToReg(d.init);
						this.emit(`move ${dest} ${src}`);
						this.freeTemp(src);
					} else {
						this.emit(`move ${dest} 0`);
					}
				}
			}
			break;

		case 'ExpressionStatement':
			if (node.expression.type === 'AssignmentExpression') {
				this.compileAssignment(node.expression);
			} else if (node.expression.type === 'CallExpression') {
				const ret = this.compileExpressionToReg(node.expression);
				this.freeTemp(ret);
			} else {
				const r = this.compileExpressionToReg(node.expression);
				this.freeTemp(r);
			}
			break;

		case 'IfStatement': {
				const elseLabel = this.newLabel('else');
				const endLabel = this.newLabel('end');
				const condReg = this.compileExpressionToReg(node.test);
				this.emit(`beq ${condReg} 0 ${elseLabel}`);
				this.freeTemp(condReg);
				this.compileStatement(node.consequent);
				this.emit(`j ${endLabel}`);
				this.emit(`${elseLabel}:`);
				if (node.alternate)
					this.compileStatement(node.alternate);
				this.emit(`${endLabel}:`);
				break;
			}

		case 'BlockStatement':
			this.traverseStatements(node.body);
			break;

		case 'WhileStatement': {
				const start = this.newLabel('while_start');
				const end = this.newLabel('while_end');
				this.breakStack.push(end);
				this.continueStack.push(start);
				this.emit(`${start}:`);
				const condReg = this.compileExpressionToReg(node.test);
				this.emit(`beq ${condReg} 0 ${end}`);
				this.freeTemp(condReg);
				this.compileStatement(node.body);
				this.emit(`j ${start}`);
				this.emit(`${end}:`);
				this.breakStack.pop();
				this.continueStack.pop();
				break;
			}

		case 'ForStatement': {
				if (node.init) {
					if (node.init.type === 'VariableDeclaration') {
						this.compileStatement(node.init);
					} else {
						const r = this.compileExpressionToReg(node.init);
						this.freeTemp(r);
					}
				}
				const start = this.newLabel('for_start');
				const end = this.newLabel('for_end');
				const updateLabel = this.newLabel('for_update');
				this.breakStack.push(end);
				this.continueStack.push(updateLabel);

				this.emit(`${start}:`);
				if (node.test) {
					const condReg = this.compileExpressionToReg(node.test);
					this.emit(`beq ${condReg} 0 ${end}`);
					this.freeTemp(condReg);
				}
				this.compileStatement(node.body);

				this.emit(`${updateLabel}:`);
				if (node.update) {
					const upr = this.compileExpressionToReg(node.update);
					this.freeTemp(upr);
				}
				this.emit(`j ${start}`);
				this.emit(`${end}:`);
				this.breakStack.pop();
				this.continueStack.pop();
				break;
			}

		case 'SwitchStatement': {
				const disc = this.compileExpressionToReg(node.discriminant);
				const endLabel = this.newLabel('switch_end');
				const caseLabels = node.cases.map((_, i) => this.newLabel(`case${i}_`));
				let defaultIndex = -1;
				for (let i = 0; i < node.cases.length; i++)
					if (node.cases[i].test === null) {
						defaultIndex = i;
						break;
					}

				this.breakStack.push(endLabel);

				for (let i = 0; i < node.cases.length; i++) {
					const cs = node.cases[i];
					if (cs.test === null)
						continue;
					if (cs.test.type === 'Literal') {
						const val = this.convertJsValueToNumber(cs.test.value, 'switch-case-literal');
						const tmp = this.newTemp();
						this.emit(`seq ${tmp} ${disc} ${val}`);
						const nextLabel = this.newLabel('sc_next');
						this.emit(`beq ${tmp} 0 ${nextLabel}`);
						this.emit(`j ${caseLabels[i]}`);
						this.emit(`${nextLabel}:`);
						this.freeTemp(tmp);
					} else {
						const rval = this.compileExpressionToReg(cs.test);
						const tmp = this.newTemp();
						this.emit(`seq ${tmp} ${disc} ${rval}`);
						const nextLabel = this.newLabel('sc_next');
						this.emit(`beq ${tmp} 0 ${nextLabel}`);
						this.emit(`j ${caseLabels[i]}`);
						this.emit(`${nextLabel}:`);
						if (this.isTempReg(rval) && rval !== tmp)
							this.freeTemp(rval);
						this.freeTemp(tmp);
					}
				}

				if (defaultIndex >= 0)
					this.emit(`j ${caseLabels[defaultIndex]}`);
				else
					this.emit(`j ${endLabel}`);

				for (let i = 0; i < node.cases.length; i++) {
					this.emit(`${caseLabels[i]}:`);
					const cs = node.cases[i];
					for (const stmt of cs.consequent)
						this.compileStatement(stmt);
				}

				this.emit(`${endLabel}:`);
				this.breakStack.pop();
				if (this.isTempReg(disc))
					this.freeTemp(disc);
				break;
			}

		case 'BreakStatement': {
				if (this.breakStack.length === 0)
					throw new Error('break not within loop or switch');
				const target = this.breakStack[this.breakStack.length - 1];
				this.emit(`j ${target}`);
				break;
			}

		case 'ContinueStatement': {
				if (this.continueStack.length === 0)
					throw new Error('continue not within loop');
				const target = this.continueStack[this.continueStack.length - 1];
				this.emit(`j ${target}`);
				break;
			}

		default:
			throw new Error('Unhandled statement type: ' + node.type);
		}
	}

	compileAssignment(node) {
		if (node.operator !== '=')
			throw new Error('Only simple assignments supported');
		const rhsReg = this.compileExpressionToReg(node.right);
		const left = node.left;
		if (left.type === 'Identifier') {
			const name = left.name;
			if (this.consts.has(name))
				throw new Error(`Cannot assign to const ${name}`);
			const dest = this.allocVar(name);
			this.emit(`move ${dest} ${rhsReg}`);
			this.freeTemp(rhsReg);
		} else if (left.type === 'MemberExpression') {
			const dev = this.resolveIC10Device(left);
			if (!dev)
				throw new Error('Unsupported member assignment - expected IC10.dN.Prop');
			this.emit(`s ${dev.pin} ${dev.prop} ${rhsReg}`);
			this.freeTemp(rhsReg);
		} else {
			throw new Error('Unsupported assignment LHS type: ' + left.type);
		}
	}

	// ---------------- expressions ---------------------
	compileExpressionToReg(node) {
		if (!node)
			throw new Error('Null expression');
		switch (node.type) {
		case 'Literal': {
				const converted = this.convertJsValueToNumber(node.value, 'literal');
				const t = this.newTemp();
				this.emit(`move ${t} ${converted}`);
				return t;
			}

		case 'Identifier': {
				const name = node.name;
				if (name === 'undefined')
					throw new Error('undefined is not supported for IC10 conversion');
				if (this.consts.has(name))
					return name; // symbol immediate
				return this.allocVar(name);
			}

		case 'BinaryExpression': {
				const leftRegOrSym = this.compileExpressionToReg(node.left);

				let rightIsLiteral = false;
				let rightVal = null;
				let rightRegOrSym = null;

				if (node.right.type === 'Literal') {
					rightIsLiteral = true;
					rightVal = this.convertJsValueToNumber(node.right.value, 'binary-right-literal');
				} else {
					rightRegOrSym = this.compileExpressionToReg(node.right);
					if (typeof rightRegOrSym === 'string' && !/^r\d+$/.test(rightRegOrSym) && !this.isTempReg(rightRegOrSym)) {
						rightIsLiteral = true;
						rightVal = rightRegOrSym;
						rightRegOrSym = null;
					}
				}

				const leftIsTemp = this.isTempReg(leftRegOrSym);
				const rightIsTemp = this.isTempReg(rightRegOrSym);

				let dest = null;
				if (rightIsTemp)
					dest = rightRegOrSym;
				else if (leftIsTemp)
					dest = leftRegOrSym;
				else
					dest = this.newTemp();

				const op = this.mapBinaryOp(node.operator);
				if (rightIsLiteral) {
					this.emit(`${op} ${dest} ${leftRegOrSym} ${rightVal}`);
				} else {
					this.emit(`${op} ${dest} ${leftRegOrSym} ${rightRegOrSym}`);
				}

				if (leftRegOrSym !== dest)
					this.freeTemp(leftRegOrSym);
				if (rightRegOrSym && rightRegOrSym !== dest)
					this.freeTemp(rightRegOrSym);

				return dest;
			}

		case 'MemberExpression': {
				const dev = this.resolveIC10Device(node);
				if (!dev)
					throw new Error('Unsupported MemberExpression (only IC10.dN.Prop supported for reads)');
				const dest = this.newTemp();
				this.emit(`l ${dest} ${dev.pin} ${dev.prop}`);
				return dest;
			}

		case 'UpdateExpression': {
				if (node.argument.type !== 'Identifier')
					throw new Error('Only simple ++/-- on identifiers supported');
				const name = node.argument.name;
				if (this.consts.has(name))
					throw new Error(`Cannot update const ${name}`);
				const reg = this.allocVar(name);
				const plus = node.operator === '++' ? 'add' : (node.operator === '--' ? 'sub' : null);
				if (!plus)
					throw new Error('Unsupported update operator ' + node.operator);
				if (node.prefix) {
					this.emit(`${plus} ${reg} ${reg} 1`);
					return reg;
				} else {
					const tmp = this.newTemp();
					this.emit(`move ${tmp} ${reg}`);
					this.emit(`${plus} ${reg} ${reg} 1`);
					return tmp;
				}
			}

		case 'CallExpression': {
				// support MemberExpression chains of arbitrary depth for namespace
				const callee = node.callee;
				if (callee.type !== 'MemberExpression')
					throw new Error('Only namespaced CallExpressions (e.g. IC10.foo(), Math.atan2()) supported currently');

				// extract function name (property) and namespace string from object chain
				const funcName = (callee.property.type === 'Identifier') ? callee.property.name
				 : (callee.property.type === 'Literal' ? String(callee.property.value) : null);
				if (!funcName)
					throw new Error('Unsupported call property type');

				// build namespace string from callee.object (walk MemberExpression/Identifier chain)
				let nsParts = [];
				let cur = callee.object;
				while (cur) {
					if (cur.type === 'Identifier') {
						nsParts.unshift(cur.name);
						break;
					}
					if (cur.type === 'MemberExpression') {
						const prop = (cur.property.type === 'Identifier') ? cur.property.name
						 : (cur.property.type === 'Literal' ? String(cur.property.value) : null);
						if (prop === null)
							break;
						nsParts.unshift(prop);
						cur = cur.object;
						continue;
					}
					break;
				}
				const namespace = nsParts.join('.');
				const handler = this._findHandlerFor(namespace, funcName);
				if (!handler)
					throw new Error(`IC function ${namespace}.${funcName} not implemented`);
				const result = handler(this, node);
				if (result == null) {
					const t = this.newTemp();
					this.emit(`move ${t} 0`);
					return t;
				}
				return result;
			}

		case 'ConditionalExpression': {
				// Compile test, consequent, alternate
				const cond = this.compileExpressionToReg(node.test);
				const cons = this.compileExpressionToReg(node.consequent);
				const alt = this.compileExpressionToReg(node.alternate);

				// Choose destination: prefer reusing a temp operand (cons or alt) to avoid extra alloc
				let dest = null;
				if (this.isTempReg(cons))
					dest = cons;
				else if (this.isTempReg(alt))
					dest = alt;
				else
					dest = this.newTemp();

				// Emit select: select dest cond cons alt
				// IC10: select r? a b c  -> r? = b if a != 0 else c
				this.emit(`select ${dest} ${cond} ${cons} ${alt}`);

				// Free operand temps that were not reused as the destination
				if (cond !== dest && this.isTempReg(cond))
					this.freeTemp(cond);
				if (cons !== dest && this.isTempReg(cons))
					this.freeTemp(cons);
				if (alt !== dest && this.isTempReg(alt))
					this.freeTemp(alt);

				return dest;
			}

		case 'ArrayExpression':
		case 'ObjectExpression':
		case 'FunctionExpression':
		case 'ArrowFunctionExpression':
			throw new Error(`Unsupported expression type for IC10 conversion: ${node.type}`);

		default:
			throw new Error('Unhandled expression type: ' + node.type);
		}
	}

	// ---------------- helpers / conversion ----------------
	convertJsValueToNumber(value, nodeHint) {
		if (value === null)
			return 0;
		const t = typeof value;
		if (t === 'number') {
			if (!isFinite(value))
				throw new Error('Numeric literal not finite (IC10 requires finite numbers)');
			return value;
		}
		if (t === 'boolean')
			return value ? 1 : 0;
		if (t === 'string') {
			const n = parseFloat(value);
			if (isNaN(n) || String(n) !== String(value).trim() && !/^\s*[-+]?\d+(\.\d+)?(\s*)$/.test(String(value))) {
				throw new Error(`String literal "${value}" cannot be converted to a numeric value for IC10`);
			}
			return n;
		}
		throw new Error(`Unsupported literal type for IC10 conversion: ${t} (node: ${nodeHint || ''})`);
	}

	mapBinaryOp(op) {
		switch (op) {
		case '+':
			return 'add';
		case '-':
			return 'sub';
		case '*':
			return 'mul';
		case '/':
			return 'div';
		case '%':
			return 'mod';
		case '==':
		case '===':
			return 'seq';
		case '!=':
			return 'sne';
		case '<':
			return 'slt';
		case '<=':
			return 'sle';
		case '>':
			return 'sgt';
		case '>=':
			return 'sge';
		}
		throw new Error('Unsupported binary operator: ' + op);
	}

	resolveIC10Device(node) {
		if (node.type !== 'MemberExpression')
			return null;
		const chain = [];
		let cur = node;
		while (cur && cur.type === 'MemberExpression') {
			const prop = cur.property.type === 'Identifier' ? cur.property.name
				 : (cur.property.type === 'Literal' ? String(cur.property.value) : null);
			if (prop === null)
				return null;
			chain.unshift(prop);
			cur = cur.object;
		}
		if (!cur || cur.type !== 'Identifier' || cur.name !== 'IC10')
			return null;
		if (chain.length < 1)
			return null;
		const pin = chain[0];
		const prop = (chain.length > 1) ? chain[1] : null;
		if (!/^d[0-5]$/.test(pin) && pin !== 'db') {
			throw new Error('Unsupported device pin: ' + pin + '. Use d0..d5 or db.');
		}
		if (!prop)
			throw new Error('Device property missing (IC10.dN.Prop).');
		return {
			pin,
			prop
		};
	}
}
// ---------- end IC10Compiler ----------
