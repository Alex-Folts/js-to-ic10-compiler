// ---------- IC10Compiler (optimized + debug/compact mode) ----------
class IC10Compiler {
	constructor(opts = {}) {
		this.debug = opts.debug === undefined ? true : !!opts.debug; // true = labels, false = compact numeric jumps

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
		// reset state (do not reset debug)
		this.code = [];
		this.preamble = [];
		this.consts = new Map();
		this.breakStack = [];
		this.continueStack = [];

		this.traverseStatements(ast.body);

		// finalize code: either keep labeled debug form or compact numeric form
		if (this.debug) {
			const pre = this.preamble.join('\n');
			const body = this.code.join('\n');
			return (pre ? pre + '\n' : '') + body;
		} else {
			// compact mode: resolve labels to numbers and remove label lines
			return this._finalizeCompactOutput();
		}
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
						// Optimization: if init is a literal/const identifier/identifier (existing var), avoid creating temp
						if (d.init.type === 'Literal') {
							const v = this.convertJsValueToNumber(d.init.value, `var init ${name}`);
							this.emit(`move ${dest} ${v}`);
						} else if (d.init.type === 'Identifier') {
							const inName = d.init.name;
							if (this.consts.has(inName)) {
								this.emit(`move ${dest} ${inName}`);
							} else if (this.varReg.has(inName)) {
								this.emit(`move ${dest} ${this.varReg.get(inName)}`);
							} else {
								// identifier not declared yet — compile expression normally
								const src = this.compileExpressionToReg(d.init);
								this.emit(`move ${dest} ${src}`);
								this.freeTemp(src);
							}
						} else {
							// fallback to general expression
							const src = this.compileExpressionToReg(d.init);
							this.emit(`move ${dest} ${src}`);
							this.freeTemp(src);
						}
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
				// Try to emit specialized branch if test is a simple binary comparison
				const elseLabel = this.newLabel('else');
				const endLabel = this.newLabel('end');

				const test = node.test;
				const cmpOps = new Set(['<', '<=', '>', '>=', '==', '===', '!=']);
				if (test && test.type === 'BinaryExpression' && cmpOps.has(test.operator)) {
					// compile left/right but avoid creating temps when possible (literal/identifier/const/MemberExpression)
					const left = test.left;
					const right = test.right;

					const leftVal = this._compileSimpleValueOrReg(left);
					const rightVal = this._compileSimpleValueOrReg(right);

					// map operator to inverse branch that jumps to else when test is false
					// For '<' -> jump if left >= right -> bge left right else
					const inverseBranch = {
						'<': 'bge',
						'<=': 'bgt',
						'>': 'ble',
						'>=': 'blt',
						'==': 'bne',
						'===': 'bne',
						'!=': 'beq'
					}
					[test.operator];

					if (inverseBranch) {
						this.emit(`${inverseBranch} ${leftVal} ${rightVal} ${elseLabel}`);
						// free any temps returned by _compileSimpleValueOrReg
						if (this.isTempReg(leftVal))
							this.freeTemp(leftVal);
						if (this.isTempReg(rightVal))
							this.freeTemp(rightVal);
						// then body / jump to end / else
						this.compileStatement(node.consequent);
						this.emit(`j ${endLabel}`);
						this.emit(`${elseLabel}:`);
						if (node.alternate)
							this.compileStatement(node.alternate);
						this.emit(`${endLabel}:`);
						break;
					}
				}

				// fallback to general approach (compute truthy numeric and test)
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

		// If RHS is simple literal or identifier/const we can avoid temp
		if (node.right.type === 'Literal' && node.left.type === 'Identifier') {
			const val = this.convertJsValueToNumber(node.right.value, 'assign-literal');
			const name = node.left.name;
			if (this.consts.has(name))
				throw new Error(`Cannot assign to const ${name}`);
			const dest = this.allocVar(name);
			this.emit(`move ${dest} ${val}`);
			return;
		}
		if (node.right.type === 'Identifier' && node.left.type === 'Identifier') {
			const srcName = node.right.name,
			dstName = node.left.name;
			const name = dstName;
			if (this.consts.has(name))
				throw new Error(`Cannot assign to const ${name}`);
			const dest = this.allocVar(name);
			if (this.consts.has(srcName)) {
				this.emit(`move ${dest} ${srcName}`);
				return;
			}
			if (this.varReg.has(srcName)) {
				this.emit(`move ${dest} ${this.varReg.get(srcName)}`);
				return;
			}
			// fallback to general
		}

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
				const callee = node.callee;
				if (callee.type !== 'MemberExpression')
					throw new Error('Only namespaced CallExpressions supported');
				const funcName = (callee.property.type === 'Identifier') ? callee.property.name
				 : (callee.property.type === 'Literal' ? String(callee.property.value) : null);
				if (!funcName)
					throw new Error('Unsupported call property type');
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
				const cond = this.compileExpressionToReg(node.test);
				const cons = this.compileExpressionToReg(node.consequent);
				const alt = this.compileExpressionToReg(node.alternate);

				let dest = null;
				if (this.isTempReg(cons))
					dest = cons;
				else if (this.isTempReg(alt))
					dest = alt;
				else
					dest = this.newTemp();

				this.emit(`select ${dest} ${cond} ${cons} ${alt}`);

				if (cond !== dest && this.isTempReg(cond))
					this.freeTemp(cond);
				if (cons !== dest && this.isTempReg(cons))
					this.freeTemp(cons);
				if (alt !== dest && this.isTempReg(alt))
					this.freeTemp(alt);

				return dest;
			}

		case 'UnaryExpression': {
				const op = node.operator;
				const arg = node.argument;

				// Helper to compile an argument into either:
				//  - a JS number (immediate), OR
				//  - a symbol string (const name), OR
				//  - a register name like 'r8'
				const compileArg = (n) => {
					if (n.type === 'Literal') {
						return this.convertJsValueToNumber(n.value, 'unary-literal');
					}
					if (n.type === 'Identifier') {
						const nm = n.name;
						if (this.consts.has(nm))
							return nm; // symbol immediate
						if (this.varReg.has(nm))
							return this.varReg.get(nm);
						// not declared yet — allocate var reg (fallback)
						return this.allocVar(nm);
					}
					// member expression or complex -> compile to reg (may return temp)
					return this.compileExpressionToReg(n);
				};

				if (op === '+') {
					// numeric conversion: basically return the compiled arg as-is (fold literals)
					const a = compileArg(arg);
					if (typeof a === 'number') {
						const t = this.newTemp();
						this.emit(`move ${t} ${a}`);
						return t;
					}
					return a;
				}

				if (op === '-') {
					const a = compileArg(arg);

					// immediate number -> fold
					if (typeof a === 'number') {
						const t = this.newTemp();
						this.emit(`move ${t} ${-a}`);
						return t;
					}

					// symbol const -> fold to immediate negative
					if (typeof a === 'string' && !/^r\d+$/.test(a) && this.consts.has(a)) {
						const val = -this.consts.get(a);
						const t = this.newTemp();
						this.emit(`move ${t} ${val}`);
						return t;
					}

					// a is a register (rN) or temp -> dest = 0 - a
					const aIsTemp = this.isTempReg(a);
					let dest;
					if (aIsTemp) {
						dest = a; // reuse temp
					} else {
						dest = this.newTemp();
					}
					this.emit(`sub ${dest} 0 ${a}`);
					// free original temp if it wasn't reused
					if (!aIsTemp && this.isTempReg(a))
						this.freeTemp(a);
					return dest;
				}

				if (op === '!') {
					const a = compileArg(arg);

					// immediate number -> fold (!0 => 1, else 0)
					if (typeof a === 'number') {
						const t = this.newTemp();
						this.emit(`move ${t} ${a === 0 ? 1 : 0}`);
						return t;
					}

					// const symbol with numeric value -> fold
					if (typeof a === 'string' && !/^r\d+$/.test(a) && this.consts.has(a)) {
						const tv = this.consts.get(a) === 0 ? 1 : 0;
						const t = this.newTemp();
						this.emit(`move ${t} ${tv}`);
						return t;
					}

					// otherwise produce seq dest a 0  (dest = (a == 0) ? 1 : 0)
					const aIsTemp = this.isTempReg(a);
					let dest;
					if (aIsTemp)
						dest = a;
					else
						dest = this.newTemp();
					this.emit(`seq ${dest} ${a} 0`);
					if (!aIsTemp && this.isTempReg(a))
						this.freeTemp(a);
					return dest;
				}

				// unsupported unary operator
				throw new Error('Unsupported unary operator: ' + op);
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

	// helper: compile simple literal/identifier/member into immediate/symbol/reg or temp
	_compileSimpleValueOrReg(node) {
		if (!node)
			throw new Error('Null node');
		if (node.type === 'Literal')
			return this.convertJsValueToNumber(node.value, 'simple-literal');
		if (node.type === 'Identifier') {
			const n = node.name;
			if (this.consts.has(n))
				return n;
			// if var exists, return its reg
			if (this.varReg.has(n))
				return this.varReg.get(n);
			// otherwise allocate (deferred) — fallback to allocating a var for identifier
			return this.allocVar(n);
		}
		if (node.type === 'MemberExpression') {
			// compile member read into temp reg and return it
			return this.compileExpressionToReg(node); // this will return a temp (and the caller should free later)
		}
		// fallback: compile general expression
		return this.compileExpressionToReg(node);
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

	// ---------------- compact-mode finalizer ----------------
	_finalizeCompactOutput() {
		// Number of preamble lines (e.g. "define ..." ). These lines will appear
		// at the top of the output and therefore must be counted when computing
		// absolute jump targets.
		const preambleCount = this.preamble.length;

		// Build mapping of labels -> numeric index (after removing label lines).
		const labelToIndex = new Map();
		const outLines = [];

		// First pass: record label positions (index in resulting outLines + preambleCount)
		for (let i = 0; i < this.code.length; i++) {
			const line = this.code[i].trim();
			const labelMatch = /^([A-Za-z_]\w*):$/.exec(line);
			if (labelMatch) {
				// label maps to the index it will have in the final output,
				// which is (current outLines length) + number of preamble lines.
				labelToIndex.set(labelMatch[1], outLines.length + preambleCount);
			} else {
				outLines.push(line);
			}
		}

		// Second pass: replace label operands in jump-like instructions with numeric indices
		const jumpOpNames = new Set(['j', 'beq', 'bne', 'blt', 'bgt', 'ble', 'bge']);
		const replaced = outLines.map((ln) => {
				// split tokens to inspect last token (jump target is usually the last token)
				const parts = ln.split(/\s+/).filter(Boolean);
				if (parts.length === 0)
					return ln;
				const op = parts[0];
				if (jumpOpNames.has(op) && parts.length >= 2) {
					const last = parts[parts.length - 1];
					if (labelToIndex.has(last)) {
						const idx = labelToIndex.get(last);
						parts[parts.length - 1] = String(idx);
						return parts.join(' ');
					}
				}
				return ln;
			});

		// Prepend preamble (if any)
		const pre = this.preamble.length ? (this.preamble.join('\n') + '\n') : '';
		return pre + replaced.join('\n');
	}
}
// ---------- end IC10Compiler ----------
