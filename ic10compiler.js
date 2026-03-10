// ---------- IC10Compiler (optimized + debug/compact mode) ----------
class IC10Compiler {
	constructor(opts = {}) {
		this.debug = opts.debug === undefined ? true : !!opts.debug; // true = labels, false = compact numeric jumps

		this.code = [];
		this.varReg = new Map();
		this.nextVarReg = 0; // r0..r7 for vars
		this.nextTempReg = 8; // r8..r15 for temps
		this.maxReg = 15;

		this.functions = new Map(); // name -> { node, label }
		this._functionLabels = new Map(); // name -> label
		this.argRegs = ['r12', 'r13', 'r14', 'r15']; // registers used for args (max 4)
		this._inFunction = null; // name of function currently compiling (or null)

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

		// new fields in constructor
		this.stackVars = new Map(); // name -> stackAddress (number)
		this.nextStackAddr = 0; // next free stack slot index (0-based)

		this._patternOptimizer = new IC10PatternOptimizer(); //TODO: pass it as an input parameter in constructor?
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

		//console.log('--- Freeing: ' + reg + ' at line: [' + this.code[this.code.length - 1] + ']');
		if (!this.debug) {
			// Attempt on-the-fly optimization: if the last emitted lines are
			// "<op> reg ..." followed by "move dest reg", we can rewrite op to write to dest directly
			// and drop the move. This saves one emitted line.
			try {
				// try the op->move->freeTemp rewrite first
				this._patternOptimizer.tryOptimizeOnFree(this.code, reg);
				// then try removing dead move copies like: "move r9 r5" that are never used
				this._patternOptimizer.tryRemoveDeadMove(this.code, reg);
				// Note: even if optimized, reg is no longer needed by future code,
				// so we still mark it free/available for reuse.
			} catch (e) {
				// optimizer must never break compilation; log and continue
				console.warn('Pattern optimizer error:', e);
			}
		}

		// normal freeing
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
		// if already allocated as a register, return it
		if (this.varReg.has(name))
			return this.varReg.get(name);

		// if we still have r0..r7 free, allocate variable register
		if (this.nextVarReg <= 7) {
			const reg = 'r' + (this.nextVarReg++);
			this.varReg.set(name, reg);
			return reg;
		}

		// otherwise allocate a stack slot (if not already)
		if (this.stackVars.has(name)) {
			const addr = this.stackVars.get(name);
			return `@stk${addr}`;
		}

		const addr = this.nextStackAddr++;
		this.stackVars.set(name, addr);

		// implicit allocation: reserve a slot by pushing 0 (so the address becomes valid)
		// For implicitly allocated variables we push 0 as initial content.
		// (Explicit declarations should use allocVarForDeclaration to push desired init value)
		this.emit(`push 0`);

		return `@stk${addr}`;
	}
	allocVarForDeclaration(name, initNode) {
		// if register already allocated, return it
		if (this.varReg.has(name))
			return this.varReg.get(name);

		// allocate register if available
		if (this.nextVarReg <= 7) {
			const reg = 'r' + (this.nextVarReg++);
			this.varReg.set(name, reg);
			// caller will emit move reg <init> if needed
			return reg;
		}

		// allocate stack slot
		if (this.stackVars.has(name)) {
			const addr = this.stackVars.get(name);
			return `@stk${addr}`;
		}

		const addr = this.nextStackAddr++;
		this.stackVars.set(name, addr);

		// emit push with initializer (if provided) or push 0
		if (initNode) {
			// If initializer is a literal
			if (initNode.type === 'Literal') {
				const v = this.convertJsValueToNumber(initNode.value, `var init ${name}`);
				this.emit(`push ${v}`);
			} else if (initNode.type === 'Identifier' && this.consts.has(initNode.name)) {
				// push const symbol
				this.emit(`push ${initNode.name}`);
			} else {
				// compile initializer expression to a value (may return a register, temp, symbol, or a @stkN token)
				const src = this.compileExpressionToReg(initNode);

				// If src indicates a stack-backed variable token like '@stkN', load it into a temp first
				if (typeof src === 'string' && src.startsWith('@stk')) {
					const addr = parseInt(src.slice(4), 10);
					const valTemp = this.loadStackVar(addr); // returns a temp register
					this.emit(`push ${valTemp}`);
					// free the loaded temp
					if (this.isTempReg(valTemp))
						this.freeTemp(valTemp);
				} else {
					// src is either a register name (rN), a temp, or a symbol/number — push it directly
					this.emit(`push ${src}`);
					// if src is a temp register, free it (we consumed its value by pushing)
					if (this.isTempReg(src))
						this.freeTemp(src);
				}
			}
		} else {
			this.emit(`push 0`);
		}

		return `@stk${addr}`;
	}
	// read stack variable at absolute address 'addr' and return a temp register with value
	// loadStackVar(addr) -> returns a temp register containing the variable value.
	// Caller MUST free the returned temp when done.
	loadStackVar(addr) {
		if (typeof addr !== 'number' || addr < 0)
			throw new Error('Invalid stack address: ' + addr);
		const SP_LIMIT = 512;
		const targetSp = addr + 1; // peek reads sp-1, so set sp = addr+1

		if (targetSp < 0 || targetSp > SP_LIMIT)
			throw new Error(`Stack address out of range: ${addr} (target sp ${targetSp})`);

		const tmpSp = this.newTemp(); // save current sp
		this.emit(`move ${tmpSp} sp`);
		this.emit(`move sp ${targetSp}`); // set sp so peek reads addr (sp-1)
		const val = this.newTemp(); // temp to receive value
		this.emit(`peek ${val}`); // val = stack[sp-1] == stack[addr]
		this.emit(`move sp ${tmpSp}`); // restore old sp
		this.freeTemp(tmpSp);
		return val;
	}
	// storeStackVar(addr, value) -> writes value into stack slot at addr.
	// value may be a number, a symbol string, or a register name (rN).
	// Frees any temporary it creates.
	storeStackVar(addr, value) {
		if (typeof addr !== 'number' || addr < 0)
			throw new Error('Invalid stack address: ' + addr);
		const SP_LIMIT = 512;
		if (addr < 0 || addr >= SP_LIMIT)
			throw new Error(`Stack address out of range: ${addr}`);

		// poke semantics: poke <address> <reg>
		// If value is immediate/symbol, move it to a temp then poke
		if (typeof value === 'number' || (typeof value === 'string' && !/^r\d+$/.test(value))) {
			const tmp = this.newTemp();
			this.emit(`move ${tmp} ${value}`);
			this.emit(`poke ${addr} ${tmp}`);
			this.freeTemp(tmp);
			return;
		}

		// value is a register like rN
		this.emit(`poke ${addr} ${value}`);
		if (this.isTempReg(value))
			this.freeTemp(value);
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

		if (this.functions.size > 0) {
			this.emit(`j bypass_hack`); //we jump after last line to prevent program execute body of functions which will be placed at the tail of the program

			// compile hoisted functions (in insertion order)
			for (const[fnName, fnNode]of this.functions.entries()) {
				const label = this._functionLabels.get(fnName);
				this._compileFunctionDeclaration(fnNode, label, fnName);
			}

			this.emit(`bypass_hack:`); //redirect bypass jump to next line after functions declaration block
		}

		// ----------------- pruning passes -----------------
		// Remove instructions that are known unreachable after unconditional jumps.
		this._removeUnreachableAfterUncondJump();

		// Remove label declarations that have no incoming references (orphan labels).
		this._removeOrphanLabels();
		// ------------------------------------------------------

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
					try {
						// evaluate the initializer at compile time
						// use a fresh seen-set seeded with this constant name to detect cycles
						const seen = new Set([name]);
						const num = this.evaluateConstExpression(d.init, seen);
						// store and emit define
						this.consts.set(name, num);
						this.preamble.push(`define ${name} ${num}`);
					} catch (e) {
						// propagate a clearer error mentioning the const name
						throw new Error(`const ${name} initializer error: ${e.message}`);
					}
				} else {
					// non-const (var/let)
					const destToken = this.allocVarForDeclaration(name, d.init);
					if (destToken && typeof destToken === 'string' && destToken.startsWith('@stk')) {
						// stack-backed var: allocVarForDeclaration already emitted the push for initialization.
						// nothing further to emit here (push already placed init value)
					} else {
						// destToken is a register like 'r0' -- handle initialization (we didn't auto-push)
						const dest = destToken;
						if (d.init) {
							// if initializer is simple literal/const/identifier we already handled simple moves earlier
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
									const src = this.compileExpressionToReg(d.init);
									this.emit(`move ${dest} ${src}`);
									this.freeTemp(src);
								}
							} else {
								const src = this.compileExpressionToReg(d.init);
								this.emit(`move ${dest} ${src}`);
								this.freeTemp(src);
							}
						} else {
							this.emit(`move ${dest} 0`);
						}
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
				const cmpOps = new Set(['<', '<=', '>', '>=', '==', '===', '!=', '!==']);
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
						'!=': 'beq',
						'!==': 'beq'
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

				// try optimized comparison branch (same approach as optimized If)
				const test = node.test;
				const cmpOps = new Set(['<', '<=', '>', '>=', '==', '===', '!=', '!==']);
				const invMap = {
					'<': 'bge',
					'<=': 'bgt',
					'>': 'ble',
					'>=': 'blt',
					'==': 'bne',
					'===': 'bne',
					'!=': 'beq',
					'!==': 'beq'
				};

				let optimized = false;
				if (test && test.type === 'BinaryExpression' && cmpOps.has(test.operator)) {
					const leftVal = this._compileSimpleValueOrReg(test.left);
					const rightVal = this._compileSimpleValueOrReg(test.right);
					const inv = invMap[test.operator];
					if (inv) {
						this.emit(`${inv} ${leftVal} ${rightVal} ${end}`);
						// free temps if produced
						if (this.isTempReg(leftVal))
							this.freeTemp(leftVal);
						if (this.isTempReg(rightVal))
							this.freeTemp(rightVal);
						optimized = true;
					} else {
						// free temps if any (defensive)
						if (this.isTempReg(leftVal))
							this.freeTemp(leftVal);
						if (this.isTempReg(rightVal))
							this.freeTemp(rightVal);
					}
				}

				if (!optimized) {
					const condReg = this.compileExpressionToReg(node.test);
					this.emit(`beq ${condReg} 0 ${end}`);
					this.freeTemp(condReg);
				}

				this.compileStatement(node.body);
				this.emit(`j ${start}`);
				this.emit(`${end}:`);
				this.breakStack.pop();
				this.continueStack.pop();
				break;
			}

		case 'ForStatement': {
				// init: can be VariableDeclaration | AssignmentExpression | expression
				if (node.init) {
					if (node.init.type === 'VariableDeclaration') {
						this.compileStatement(node.init);
					} else if (node.init.type === 'AssignmentExpression') {
						// handle assignment in init (e.g. for (k = 1; ...))
						this.compileAssignment(node.init);
					} else {
						// other expressions (e.g. function calls)
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

				// optimize simple comparison test into single conditional branch
				if (node.test) {
					const test = node.test;
					const cmpOps = new Set(['<', '<=', '>', '>=', '==', '===', '!=', '!==']);
					const invMap = {
						'<': 'bge',
						'<=': 'bgt',
						'>': 'ble',
						'>=': 'blt',
						'==': 'bne',
						'===': 'bne',
						'!=': 'beq',
						'!==': 'beq'
					};

					let optimized = false;
					if (test.type === 'BinaryExpression' && cmpOps.has(test.operator)) {
						const leftVal = this._compileSimpleValueOrReg(test.left);
						const rightVal = this._compileSimpleValueOrReg(test.right);
						const inv = invMap[test.operator];
						if (inv) {
							this.emit(`${inv} ${leftVal} ${rightVal} ${end}`);
							if (this.isTempReg(leftVal))
								this.freeTemp(leftVal);
							if (this.isTempReg(rightVal))
								this.freeTemp(rightVal);
							optimized = true;
						} else {
							if (this.isTempReg(leftVal))
								this.freeTemp(leftVal);
							if (this.isTempReg(rightVal))
								this.freeTemp(rightVal);
						}
					}

					if (!optimized) {
						const condReg = this.compileExpressionToReg(node.test);
						this.emit(`beq ${condReg} 0 ${end}`);
						this.freeTemp(condReg);
					}
				}

				this.compileStatement(node.body);

				this.emit(`${updateLabel}:`);
				if (node.update) {
					if (node.update.type === 'AssignmentExpression') {
						// handle assignment in update (e.g. for (...; ...; k = k + 1))
						this.compileAssignment(node.update);
					} else {
						const upr = this.compileExpressionToReg(node.update);
						this.freeTemp(upr);
					}
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

					const nextLabel = this.newLabel('sc_next');

					// If literal -> emit direct branch bne disc val nextLabel (no temp)
					if (cs.test.type === 'Literal') {
						const val = this.convertJsValueToNumber(cs.test.value, 'switch-case-literal');
						this.emit(`bne ${disc} ${val} ${nextLabel}`);
						this.emit(`j ${caseLabels[i]}`);
						this.emit(`${nextLabel}:`);
					} else {
						// general expression -> compile RHS into reg and compare directly
						const rval = this.compileExpressionToReg(cs.test);
						this.emit(`bne ${disc} ${rval} ${nextLabel}`);
						this.emit(`j ${caseLabels[i]}`);
						this.emit(`${nextLabel}:`);
						if (this.isTempReg(rval))
							this.freeTemp(rval);
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

		case 'ReturnStatement': {
				if (!this._inFunction)
					throw new Error('return must be inside a function');
				if (node.argument) {
					const r = this.compileExpressionToReg(node.argument);
					// move into r1 (caller's expectation)
					if (typeof r === 'number' || (typeof r === 'string' && !/^r\d+$/.test(r))) {
						// immediate / symbol
						this.emit(`move r1 ${r}`);
					} else {
						// register (temp or var reg)
						this.emit(`move r1 ${r}`);
						if (this.isTempReg(r))
							this.freeTemp(r);
					}
				} else {
					this.emit(`move r1 0`);
				}
				// return using ra
				this.emit(`j ra`);
				break;
			}

		case 'FunctionDeclaration': {
				// Hoist: register function and don't emit body now
				const fnName = node.id && node.id.name;
				if (!fnName)
					throw new Error('Unnamed function declaration not supported');
				const label = `fn_${fnName}`;
				// store AST node and label for later compilation
				this.functions.set(fnName, node);
				this._functionLabels.set(fnName, label);
				// don't emit anything now (hoisted)
				break;
			}

		default:
			throw new Error('Unhandled statement type: ' + node.type);
		}
	}

	compileAssignment(node) {
		// support compound assignments like +=, -=, *=, /=
		const compoundMap = {
			'+=': 'add',
			'-=': 'sub',
			'*=': 'mul',
			'/=': 'div'
		};

		if (node.operator === '=') {
			// existing simple assign handling
			const rhsReg = this.compileExpressionToReg(node.right);
			const left = node.left;
			if (left.type === 'Identifier') {
				const name = left.name;
				if (this.consts.has(name))
					throw new Error(`Cannot assign to const ${name}`);
				const dest = this.allocVar(name);

				// If dest is stack-backed, poke instead of move
				if (typeof dest === 'string' && dest.startsWith('@stk')) {
					const addr = parseInt(dest.slice(4), 10);
					// if rhsReg is immediate or symbol, move to temp then poke
					if (typeof rhsReg === 'number' || (typeof rhsReg === 'string' && !/^r\d+$/.test(rhsReg))) {
						const tmp = this.newTemp();
						this.emit(`move ${tmp} ${rhsReg}`);
						this.emit(`poke ${addr} ${tmp}`);
						this.freeTemp(tmp);
					} else {
						// rhsReg is a register
						this.emit(`poke ${addr} ${rhsReg}`);
						if (this.isTempReg(rhsReg))
							this.freeTemp(rhsReg);
					}
				} else {
					// register-backed var
					this.emit(`move ${dest} ${rhsReg}`);
					this.freeTemp(rhsReg);
				}
			} else if (left.type === 'MemberExpression') {
				const dev = this.resolveIC10Device(left);
				if (!dev)
					throw new Error('Unsupported member assignment - expected IC10.dN.Prop');
				this.emit(`s ${dev.pin} ${dev.prop} ${rhsReg}`);
				this.freeTemp(rhsReg);
			} else {
				throw new Error('Unsupported assignment LHS type: ' + left.type);
			}
			return;
		}

		// compound assignment
		if (!(node.operator in compoundMap))
			throw new Error('Only simple and compound assignments supported');

		const op = compoundMap[node.operator];

		// Helper compile right side to one of:
		// - immediate number or symbol string (if literal/const)
		// - register name (rN)
		const compileRHSAsValue = (expr) => {
			if (expr.type === 'Literal') {
				return this.convertJsValueToNumber(expr.value, 'assign-compound-literal');
			}
			if (expr.type === 'Identifier') {
				const nm = expr.name;
				if (this.consts.has(nm))
					return nm;
				if (this.varReg.has(nm))
					return this.varReg.get(nm);
				// identifier not declared: compile to reg (alloc)
				return this.allocVar(nm);
			}
			// other cases (MemberExpression, BinaryExpression, Call, etc) -> compile to reg
			return this.compileExpressionToReg(expr);
		};

		const left = node.left;
		if (left.type === 'Identifier') {
			const name = left.name;
			if (this.consts.has(name))
				throw new Error(`Cannot assign to const ${name}`);
			const dest = this.allocVar(name);

			// compile RHS
			const rhsVal = compileRHSAsValue(node.right);

			// If dest is stack-backed, we need to load current, compute and poke back.
			if (typeof dest === 'string' && dest.startsWith('@stk')) {
				const addr = parseInt(dest.slice(4), 10);
				// load current into temp
				const cur = this.loadStackVar(addr); // returns temp
				// handle rhsVal immediate/symbol
				if (typeof rhsVal === 'number' || (typeof rhsVal === 'string' && !/^r\d+$/.test(rhsVal))) {
					// compute cur = cur op rhsVal
					this.emit(`${op} ${cur} ${cur} ${rhsVal}`);
					this.emit(`poke ${addr} ${cur}`);
					this.freeTemp(cur);
					return;
				} else {
					// rhsVal is register (maybe temp)
					const rhsIsTemp = this.isTempReg(rhsVal);
					if (rhsIsTemp) {
						// do rhsVal = cur op rhsVal ; then poke rhsVal
						this.emit(`${op} ${rhsVal} ${cur} ${rhsVal}`);
						this.emit(`poke ${addr} ${rhsVal}`);
						this.freeTemp(cur);
						this.freeTemp(rhsVal);
						return;
					} else {
						// rhsVal is a non-temp reg; compute into cur and poke
						this.emit(`${op} ${cur} ${cur} ${rhsVal}`);
						this.emit(`poke ${addr} ${cur}`);
						this.freeTemp(cur);
						return;
					}
				}
			}

			// dest is register-backed var
			if (typeof rhsVal === 'number' || (typeof rhsVal === 'string' && !/^r\d+$/.test(rhsVal))) {
				this.emit(`${op} ${dest} ${dest} ${rhsVal}`);
				return;
			}

			// rhsVal is a register (maybe same as dest)
			if (rhsVal === dest) {
				// a += a  -> add dest dest dest
				this.emit(`${op} ${dest} ${dest} ${dest}`);
			} else {
				this.emit(`${op} ${dest} ${dest} ${rhsVal}`);
				if (this.isTempReg(rhsVal) && rhsVal !== dest)
					this.freeTemp(rhsVal);
			}
			return;
		}

		if (left.type === 'MemberExpression') {
			// read current property, compute, write back
			const dev = this.resolveIC10Device(left);
			if (!dev)
				throw new Error('Unsupported member assignment - expected IC10.dN.Prop');

			// load current value
			const cur = this.newTemp();
			this.emit(`l ${cur} ${dev.pin} ${dev.prop}`);

			// compile RHS into immediate or reg
			const rhsVal = compileRHSAsValue(node.right);

			// choose destination for computation: prefer reusing rhs temp if it's temp,
			// otherwise reuse cur so we can s ... dest afterward.
			if (typeof rhsVal === 'string' && !/^r\d+$/.test(rhsVal)) {
				// immediate/symbol: compute into cur (cur = op cur imm)
				this.emit(`${op} ${cur} ${cur} ${rhsVal}`);
				this.emit(`s ${dev.pin} ${dev.prop} ${cur}`);
				this.freeTemp(cur);
				return;
			}

			// rhsVal is a register (maybe temp)
			const rhsIsTemp = this.isTempReg(rhsVal);

			// prefer reusing rhsVal as dest if it's a temp
			if (rhsIsTemp) {
				// perform rhsVal = cur op rhsVal
				this.emit(`${op} ${rhsVal} ${cur} ${rhsVal}`);
				this.emit(`s ${dev.pin} ${dev.prop} ${rhsVal}`);
				this.freeTemp(cur);
				this.freeTemp(rhsVal);
				return;
			} else {
				// rhsVal is a non-temp register; compute into cur: cur = cur op rhsVal
				this.emit(`${op} ${cur} ${cur} ${rhsVal}`);
				this.emit(`s ${dev.pin} ${dev.prop} ${cur}`);
				this.freeTemp(cur);
				return;
			}
		}

		throw new Error('Unsupported assignment LHS type for compound operator: ' + left.type);
	}

	// ---------------- expressions ---------------------
	compileExpressionToReg(node) {
		if (!node)
			throw new Error('Null expression');
		switch (node.type) {
		case 'Literal': {
				const converted = this.convertJsValueToNumber(node.value, 'literal');
				//const t = this.newTemp();
				//this.emit(`move ${t} ${converted}`);
				//return t;
				return converted; //if its just number - we return number's value?
			}

		case 'Identifier': {
				const name = node.name;
				if (name === 'undefined')
					throw new Error('undefined is not supported for IC10 conversion');

				// Special JS globals -> IC10 symbols
				if (name === 'Infinity')
					return 'pinf';
				if (name === 'NaN')
					return 'nan';

				// compile-time const symbol
				if (this.consts.has(name))
					return name;

				// if var mapped to register
				if (this.varReg.has(name))
					return this.varReg.get(name);

				// if var mapped to stack slot, load it into a temp and return that temp
				if (this.stackVars.has(name)) {
					const addr = this.stackVars.get(name);
					return this.loadStackVar(addr); // returns temp register; caller must free
				}

				// not allocated yet: allocate (allocVar will push 0 if stack slot allocated)
				const alloc = this.allocVar(name);
				if (typeof alloc === 'string' && alloc.startsWith('@stk')) {
					const addr = parseInt(alloc.slice(4), 10);
					return this.loadStackVar(addr);
				}
				return alloc; // register like 'rN'
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
				// Only ++/-- on identifiers supported
				if (node.argument.type !== 'Identifier')
					throw new Error('Only simple ++/-- on identifiers supported');

				const name = node.argument.name;
				if (this.consts.has(name))
					throw new Error(`Cannot update const ${name}`);

				const op = node.operator === '++' ? 'add' : (node.operator === '--' ? 'sub' : null);
				if (!op)
					throw new Error('Unsupported update operator ' + node.operator);

				// Get variable location (may be 'rN' or '@stkN')
				const loc = this.allocVar(name);

				// Helper to do operation on a register (var reg)
				const doRegUpdate = (reg) => {
					if (node.prefix) {
						// ++x  -> perform update, return reg (var reg)
						this.emit(`${op} ${reg} ${reg} 1`);
						return reg;
					} else {
						// x++ -> return old value: tmp = reg; reg = reg +/- 1; return tmp
						const tmp = this.newTemp();
						this.emit(`move ${tmp} ${reg}`);
						this.emit(`${op} ${reg} ${reg} 1`);
						return tmp;
					}
				};

				// If loc is stack token, handle via peek/poke sequence
				if (typeof loc === 'string' && loc.startsWith('@stk')) {
					const addr = parseInt(loc.slice(4), 10);

					// load current value into a temp (loadStackVar returns a temp)
					const cur = this.loadStackVar(addr); // returns temp (r8..r15)

					if (node.prefix) {
						// ++x (prefix): modify cur in place, poke back, return cur (temp)
						this.emit(`${op} ${cur} ${cur} 1`);
						// write back to stack: poke addr cur
						this.emit(`poke ${addr} ${cur}`);
						// return cur (do NOT free it here — caller will free when appropriate)
						return cur;
					} else {
						// x++ (postfix): return old value; perform update in cur and poke
						const old = this.newTemp();
						this.emit(`move ${old} ${cur}`); // old = cur
						this.emit(`${op} ${cur} ${cur} 1`); // cur = cur +/- 1
						this.emit(`poke ${addr} ${cur}`); // write back
						// free the cur temp (we no longer need it)
						if (this.isTempReg(cur))
							this.freeTemp(cur);
						// return the old value (temp) to caller
						return old;
					}
				}

				// Otherwise loc is a register like 'r0'..'r7'
				return doRegUpdate(loc);
			}

		case 'CallExpression': {
				// If namespaced MemberExpression (IC10.*, Math.* etc.)
				if (node.callee.type === 'MemberExpression') {
					const callee = node.callee;
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

				// simple identifier calls: user-defined functions
				if (node.callee.type === 'Identifier') {
					const fnName = node.callee.name;
					if (!this.functions.has(fnName))
						throw new Error(`Function ${fnName} not found`);

					const args = node.arguments || [];
					if (args.length > this.argRegs.length)
						throw new Error(`Function ${fnName} supports up to ${this.argRegs.length} arguments`);

					// evaluate args and move into arg registers (r12..)
					const argRegsUsed = [];
					for (let i = 0; i < args.length; i++) {
						const a = args[i];
						const v = (a.type === 'Literal') ? this.convertJsValueToNumber(a.value, `call-arg${i}`) : this.compileExpressionToReg(a);
						const targ = this.argRegs[i];
						this.emit(`move ${targ} ${v}`);
						// if v was a temp register, free it
						if (this.isTempReg(v))
							this.freeTemp(v);
						argRegsUsed.push(targ);
					}

					// call
					const label = this._functionLabels.get(fnName) || `fn_${fnName}`;
					this.emit(`jal ${label}`);

					// retrieve result into a temp and return it
					const retT = this.newTemp();
					this.emit(`move ${retT} r1`);
					return retT;
				}

				throw new Error('Only namespaced calls and simple identifier function calls are supported');
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

				// Helper to compile/resolve argument to number / symbol / register
				const compileArg = (n) => {
					if (n.type === 'Literal')
						return this.convertJsValueToNumber(n.value, 'unary-literal');
					if (n.type === 'Identifier') {
						const nm = n.name;
						// map JS globals first
						if (nm === 'Infinity')
							return 'pinf';
						if (nm === 'NaN')
							return 'nan';
						if (this.consts.has(nm))
							return nm; // symbol immediate
						if (this.varReg.has(nm))
							return this.varReg.get(nm);
						return this.allocVar(nm);
					}
					return this.compileExpressionToReg(n);
				};

				if (op === '+') {
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
						//const t = this.newTemp();
						//this.emit(`move ${t} ${-a}`);
						//return t;
						return -a; //return negated number's value?
					}

					// symbol-level handling for infinities/nan
					if (typeof a === 'string' && !/^r\d+$/.test(a)) {
						if (a === 'pinf')
							return 'ninf';
						if (a === 'ninf')
							return 'pinf';
						if (a === 'nan')
							return 'nan';
						// otherwise: a is a const symbol name — we can't fold, so emit subtraction like normal below
					}

					// fallback: compute 0 - a (dest may reuse a if it's a temp)
					const aIsTemp = this.isTempReg(a);
					let dest;
					if (aIsTemp)
						dest = a;
					else
						dest = this.newTemp();
					this.emit(`sub ${dest} 0 ${a}`);
					if (!aIsTemp && this.isTempReg(a))
						this.freeTemp(a);
					return dest;
				}

				if (op === '!') {
					const a = compileArg(arg);

					// immediate numeric folding: 0 or NaN are falsy => ! => 1; others => 0
					if (typeof a === 'number') {
						const t = this.newTemp();
						const v = (a === 0 || Number.isNaN(a)) ? 1 : 0;
						this.emit(`move ${t} ${v}`);
						return t;
					}

					// symbol-level folding:
					if (typeof a === 'string' && !/^r\d+$/.test(a)) {
						// NaN is falsy -> !NaN == 1; infinities are truthy -> !pinf == 0
						if (a === 'nan') {
							const t = this.newTemp();
							this.emit(`move ${t} 1`);
							return t;
						}
						if (a === 'pinf' || a === 'ninf') {
							const t = this.newTemp();
							this.emit(`move ${t} 0`);
							return t;
						}
						// named const symbol: we cannot be sure at compile-time; emit seq dest a 0 (dest = (a==0)?1:0)
					}

					// general case: dest = (a == 0) ? 1 : 0
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

				throw new Error('Unsupported unary operator: ' + op);
			}

		case 'LogicalExpression': {
				const op = node.operator; // '&&' or '||'
				if (op !== '&&' && op !== '||')
					throw new Error('Unsupported logical operator: ' + op);

				// Compile left side first (may return number, symbol name, or rN)
				const leftVal = this.compileExpressionToReg(node.left);

				// Helper to compile right and return its reg/symbol/number
				const compileRight = () => {
					return this.compileExpressionToReg(node.right);
				};

				// If left is immediate number -> we can fold at compile time
				if (typeof leftVal === 'number') {
					if (op === '&&') {
						// if left is falsy (0) -> return 0; else return right
						if (leftVal === 0)
							return 0;
						const rv = compileRight();
						// if rv is temp, return it; otherwise move into temp for uniformity
						if (this.isTempReg(rv))
							return rv;
						if (typeof rv === 'number' || (typeof rv === 'string' && !/^r\d+$/.test(rv))) {
							const t = this.newTemp();
							this.emit(`move ${t} ${rv}`);
							return t;
						}
						return rv;
					} else { // '||'
						// if left is truthy -> return left (non-zero), else return right
						if (leftVal !== 0)
							return leftVal;
						const rv = compileRight();
						if (this.isTempReg(rv))
							return rv;
						if (typeof rv === 'number' || (typeof rv === 'string' && !/^r\d+$/.test(rv))) {
							const t = this.newTemp();
							this.emit(`move ${t} ${rv}`);
							return t;
						}
						return rv;
					}
				}

				// leftVal is a symbol or register. We'll generate runtime test.
				const leftIsTemp = this.isTempReg(leftVal);
				const testTmp = this.newTemp();
				const falseLabel = this.newLabel(op === '&&' ? 'land_false' : 'lor_false');
				const endLabel = this.newLabel(op === '&&' ? 'land_end' : 'lor_end');

				// seq testTmp leftVal 0  -> testTmp == 1 when left == 0
				this.emit(`seq ${testTmp} ${leftVal} 0`);
				if (op === '&&') {
					// if left == 0 -> falseLabel (result should be 0)
					this.emit(`beq ${testTmp} 1 ${falseLabel}`);
					// left truthy -> evaluate right
					// free testTmp now (no longer needed)
					this.freeTemp(testTmp);

					const rightRegOrVal = compileRight();

					// choose dest: if right is temp, reuse it; else allocate a temp and move
					let dest;
					if (this.isTempReg(rightRegOrVal)) {
						dest = rightRegOrVal;
					} else {
						dest = this.newTemp();
						this.emit(`move ${dest} ${rightRegOrVal}`);
					}

					this.emit(`j ${endLabel}`);
					this.emit(`${falseLabel}:`);
					// false case -> result 0
					// if dest not allocated yet, allocate one to be consistent
					const zeroHolder = (typeof dest !== 'undefined') ? dest : this.newTemp();
					this.emit(`move ${zeroHolder} 0`);
					// If dest was not previously set, set it now
					if (typeof dest === 'undefined')
						dest = zeroHolder;

					this.emit(`${endLabel}:`);

					// cleanup: free leftVal if it was a temp
					if (leftIsTemp)
						this.freeTemp(leftVal);

					return dest;
				} else { // op === '||'
					// for OR: if left != 0 -> truthy -> keep left, else evaluate right
					// seq testTmp leftVal 0 -> 1 when left == 0
					// we branch to evaluate right when testTmp == 1
					this.emit(`beq ${testTmp} 1 ${falseLabel}`);
					// left is truthy path: we want to return left as result
					// allocate dest: if left is temp reuse it, else if left is symbol move into temp
					let destForLeft;
					if (leftIsTemp) {
						destForLeft = leftVal;
					} else if (typeof leftVal === 'string') {
						// symbol or var register; if it's a var register (rN) we can return it directly
						if (/^r\d+$/.test(leftVal)) {
							destForLeft = leftVal;
						} else {
							// symbol: move into temp so we have a consistent return register
							destForLeft = this.newTemp();
							this.emit(`move ${destForLeft} ${leftVal}`);
						}
					} else {
						// should not happen, but fallback
						destForLeft = this.newTemp();
						this.emit(`move ${destForLeft} ${leftVal}`);
					}
					this.emit(`j ${endLabel}`);

					// falseLabel -> left was falsy -> evaluate right and return it
					this.emit(`${falseLabel}:`);
					this.freeTemp(testTmp);
					const rightVal = compileRight();

					let dest;
					if (this.isTempReg(rightVal)) {
						dest = rightVal;
					} else {
						dest = this.newTemp();
						this.emit(`move ${dest} ${rightVal}`);
					}

					this.emit(`${endLabel}:`);

					// cleanup: if left was temp and we didn't reuse it (i.e. dest !== leftVal), free it
					if (leftIsTemp && dest !== leftVal)
						this.freeTemp(leftVal);

					return dest;
				}
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
			// if var exists in registers, return reg
			if (this.varReg.has(n))
				return this.varReg.get(n);
			// if stack var exists, return temp with loaded value
			if (this.stackVars.has(n)) {
				const addr = this.stackVars.get(n);
				return this.loadStackVar(addr); // returns a temp register (caller should free it)
			}
			// otherwise allocate (this will push 0 if it becomes stack)
			const alloc = this.allocVar(n);
			if (typeof alloc === 'string' && alloc.startsWith('@stk')) {
				const addr = parseInt(alloc.slice(4), 10);
				return this.loadStackVar(addr);
			}
			return alloc;
		}
		if (node.type === 'MemberExpression') {
			// compile member read into temp reg and return it
			return this.compileExpressionToReg(node); // this will return a temp (and the caller should free later)
		}
		// fallback: compile general expression
		return this.compileExpressionToReg(node);
	}

	_compileFunctionDeclaration(fnNode, label, fnName) {
		// snapshot caller state
		const savedVarReg = this.varReg;
		const savedNextVarReg = this.nextVarReg;
		const savedNextTempReg = this.nextTempReg;
		const savedTempPool = this.tempPool.slice();
		const savedTempInUse = new Set(this.tempInUse);
		const saved_isTempReg = this.isTempReg; // not strictly needed

		// fresh local state for function
		this.varReg = new Map();
		this.nextVarReg = 0; // local r0..r7 for function locals/params
		this.nextTempReg = 8; // r8..r15 for temps inside function
		this.tempPool = [];
		this.tempInUse = new Set();

		// label for function entry
		this.emit(`${label}:`);
		// set current function marker
		this._inFunction = fnName;

		// move parameters from argRegs into local vars
		const params = fnNode.params || [];
		for (let i = 0; i < params.length; i++) {
			const p = params[i];
			if (p.type !== 'Identifier')
				throw new Error('Only simple identifier params supported');
			const dest = this.allocVar(p.name); // will allocate r0..r7 or stack
			const argReg = this.argRegs[i];
			if (!argReg)
				throw new Error(`Function ${fnName} supports up to ${this.argRegs.length} args`);
			// argReg may be immediate/register/symbol; just move
			this.emit(`move ${dest} ${argReg}`);
		}

		// compile function body statements
		if (fnNode.body && fnNode.body.type === 'BlockStatement') {
			// walk through statements; ReturnStatement handled in compileStatement
			for (const s of fnNode.body.body) {
				this.compileStatement(s);
			}
		} else {
			throw new Error('Unsupported function body format');
		}

		// fallthrough: ensure function returns (default 0)
		this.emit(`move r1 0`);
		this.emit(`j ra`);

		// restore caller state
		this.varReg = savedVarReg;
		this.nextVarReg = savedNextVarReg;
		this.nextTempReg = savedNextTempReg;
		this.tempPool = savedTempPool;
		this.tempInUse = savedTempInUse;
		this._inFunction = null;
	}

	// ---------------- helpers / conversion ----------------
	convertJsValueToNumber(value, nodeHint) {
		if (value === null)
			return 0;
		const t = typeof value;

		if (t === 'number') {
			// handle special numeric values as IC10 symbols
			if (Number.isNaN(value))
				return 'nan';
			if (value === Infinity)
				return 'pinf';
			if (value === -Infinity)
				return 'ninf';

			if (!isFinite(value))
				throw new Error('Numeric literal not finite (IC10 requires finite numbers)');
			return value;
		}

		if (t === 'boolean')
			return value ? 1 : 0;

		if (t === 'string') {
			const n = parseFloat(value);
			if (isNaN(n) || (String(n) !== String(value).trim() && !/^\s*[-+]?\d+(\.\d+)?(\s*)$/.test(String(value)))) {
				throw new Error(`String literal "${value}" cannot be converted to a numeric value for IC10`);
			}
			return n;
		}

		throw new Error(`Unsupported literal type for IC10 conversion: ${t} (node: ${nodeHint || ''})`);
	}

	// Evaluate an expression AST node at compile-time for const initialization.
	// Returns a numeric value or throws on unsupported/invalid usage.
	evaluateConstExpression(node, seen = new Set()) {
		if (!node)
			throw new Error('Empty const initializer');

		// prevent recursive cycles
		if (node.type === 'Identifier') {
			if (seen.has(node.name))
				throw new Error(`Circular const reference to ${node.name}`);
		}

		switch (node.type) {
		case 'Literal':
			// reuse existing conversion logic (handles booleans/null/strings -> numbers)
			return this.convertJsValueToNumber(node.value, 'const-eval-literal');

			// ---- Identifier case (replace existing Identifier branch) ----
		case 'Identifier': {
				const name = node.name;
				// support JS global numeric names as IC10 symbols
				if (name === 'Infinity')
					return 'pinf';
				if (name === '-Infinity')
					return 'ninf'; // unlikely, but harmless
				if (name === 'NaN')
					return 'nan';

				if (!this.consts.has(name))
					throw new Error(`Const ${name} used before its declaration`);
				return this.consts.get(name);
			}

			// ---- UnaryExpression case (replace existing UnaryExpression branch) ----
		case 'UnaryExpression': {
				const op = node.operator;
				// evaluate argument (may return number or a symbol string like 'pinf'/'ninf'/'nan')
				const argVal = this.evaluateConstExpression(node.argument, seen);

				// If argument produced a special IC10 symbol string, handle those cases explicitly.
				if (typeof argVal === 'string') {
					if (argVal === 'pinf') {
						if (op === '-')
							return 'ninf';
						if (op === '+')
							return 'pinf';
						if (op === '!')
							return 0; // !Infinity -> false -> 0
					}
					if (argVal === 'ninf') {
						if (op === '-')
							return 'pinf';
						if (op === '+')
							return 'ninf';
						if (op === '!')
							return 0; // !-Infinity -> false -> 0
					}
					if (argVal === 'nan') {
						if (op === '-')
							return 'nan';
						if (op === '+')
							return 'nan';
						if (op === '!')
							return 1; // !NaN -> true -> 1 (NaN is falsy)
					}
					// If argVal is some other symbol name (user const), we can't evaluate further here.
					throw new Error(`Cannot evaluate unary ${op} on symbol ${argVal} in const initializer`);
				}

				// argVal is numeric -> do numeric unary ops
				switch (op) {
				case '+':
					return +argVal;
				case '-':
					return -argVal;
				case '!':
					return (argVal === 0 || Number.isNaN(argVal)) ? 1 : 0;
				default:
					throw new Error(`Unsupported unary operator in const initializer: ${op}`);
				}
			}

		case 'BinaryExpression': {
				const op = node.operator;
				// evaluate operands (passing same seen set)
				const left = this.evaluateConstExpression(node.left, seen);
				const right = this.evaluateConstExpression(node.right, seen);

				switch (op) {
				case '+':
					return left + right;
				case '-':
					return left - right;
				case '*':
					return left * right;
				case '/':
					if (right === 0)
						throw new Error('Division by zero in const initializer');
					return left / right;
				case '%':
					if (right === 0)
						throw new Error('Modulo by zero in const initializer');
					return left % right;
				case '**':
					return Math.pow(left, right);
					// comparisons return 1/0 to be consistent with numeric boolean handling
				case '==':
				case '===':
					return left === right ? 1 : 0;
				case '!=':
				case '!==':
					return left !== right ? 1 : 0;
				case '<':
					return left < right ? 1 : 0;
				case '<=':
					return left <= right ? 1 : 0;
				case '>':
					return left > right ? 1 : 0;
				case '>=':
					return left >= right ? 1 : 0;
				default:
					throw new Error(`Unsupported binary operator in const initializer: ${op}`);
				}
			}

		case 'ParenthesizedExpression':
			// some parsers include this; evaluate inner
			return this.evaluateConstExpression(node.expression, seen);

		default:
			throw new Error(`Unsupported expression in const initializer: ${node.type}`);
		}
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
		case '!==':
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
		const jumpOpNames = new Set(['j', 'jal', 'beq', 'bne', 'blt', 'bgt', 'ble', 'bge']);
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

	// remove instructions that are unreachable because an unconditional 'j' preceded them
	_removeUnreachableAfterUncondJump() {
		if (!Array.isArray(this.code) || this.code.length === 0)
			return;

		const isLabel = (ln) => /^[A-Za-z_]\w*:\s*$/.test((ln || '').trim());
		const isBlank = (ln) => /^\s*$/.test((ln || '').trim());

		const out = [];
		for (let i = 0; i < this.code.length; i++) {
			const line = this.code[i];
			const tl = (line || '').trim();

			// always keep label lines
			if (isLabel(tl) || isBlank(tl)) {
				out.push(line);
				continue;
			}

			// if this is an unconditional jump, keep it and skip following non-label lines
			// We consider 'j' as unconditional jump opcode (token at beginning)
			const parts = tl.split(/\s+/).filter(Boolean);
			const op = parts[0] ? parts[0].toLowerCase() : '';
			if (op === 'j') {
				out.push(line);
				// skip until next label (but keep labels)
				let j = i + 1;
				for (; j < this.code.length; j++) {
					const next = this.code[j];
					const nt = (next || '').trim();
					if (isLabel(nt)) {
						// stop skipping and allow loop to process this label next iteration
						break;
					}
					// otherwise skip the instruction (it's unreachable)
				}
				i = j - 1; // outer loop will increment i -> j
				continue;
			}

			// not an unconditional jump or label: keep normally
			out.push(line);
		}

		this.code = out;
	}

	// remove labels that are not referenced by any jump/branch in the current code
	_removeOrphanLabels() {
		if (!Array.isArray(this.code) || this.code.length === 0)
			return;

		// collect declared labels and build a map label->index
		const labelDeclRegex = /^([A-Za-z_]\w*):\s*$/;
		const declared = new Set();
		for (const ln of this.code) {
			const m = (ln || '').trim().match(labelDeclRegex);
			if (m)
				declared.add(m[1]);
		}
		if (declared.size === 0)
			return;

		// find referenced labels from jump-like ops
		const jumpOpNames = new Set(['j', 'jal', 'beq', 'bne', 'blt', 'bgt', 'ble', 'bge']);
		const referenced = new Set();
		for (const ln of this.code) {
			const tl = (ln || '').trim();
			if (!tl)
				continue;
			const parts = tl.split(/\s+/).filter(Boolean);
			if (parts.length < 2)
				continue;
			const op = parts[0].toLowerCase();
			if (jumpOpNames.has(op)) {
				const target = parts[parts.length - 1];
				// only add if it looks like a label name (not numeric after finalize)
				if (/^[A-Za-z_]\w*$/.test(target))
					referenced.add(target);
			}
		}

		// remove any declared labels that aren't referenced
		if (referenced.size === 0) {
			// none referenced -> remove all labels
			this.code = this.code.filter(ln => !labelDeclRegex.test((ln || '').trim()));
			return;
		}

		// filter out unused label lines
		this.code = this.code.filter(ln => {
				const m = (ln || '').trim().match(labelDeclRegex);
				if (!m)
					return true;
				const lbl = m[1];
				return referenced.has(lbl);
			});
	}
}
// ---------- end IC10Compiler ----------
