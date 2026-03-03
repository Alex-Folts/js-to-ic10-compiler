class JsIC10CallHandlers {
	constructor() {}

	Register(comp) {
		// register existing IC10 handlers using legacy 2-arg form (defaults to IC10 namespace)
		comp.registerCallHandler('sleep', this._handleSleep.bind(comp));
		comp.registerCallHandler('yield', this._handleYield.bind(comp));
		comp.registerCallHandler('hcf', this._handleHcf.bind(comp));
		comp.registerCallHandler('lerp', this._handleLerp.bind(comp));
		comp.registerCallHandler('IC10', 'HASH', this._handleHASH.bind(comp));
	}

	// ---------------- IC10 call handlers (IC10.* existing handlers): ----------------
	_handleSleep(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('IC10.sleep(seconds) expects exactly one argument');
		const arg = args[0];
		if (arg.type === 'Literal') {
			const num = this.convertJsValueToNumber(arg.value, 'sleep-arg');
			this.emit(`sleep ${num}`);
			return null;
		}
		const r = this.compileExpressionToReg(arg);
		if (typeof r === 'string' && !/^r\d+$/.test(r)) {
			this.emit(`sleep ${r}`);
		} else {
			this.emit(`sleep ${r}`);
			this.freeTemp(r);
		}
		return null;
	}

	_handleYield(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 0)
			throw new Error('IC10.yield() expects no arguments');
		this.emit('yield');
		return null;
	}

	_handleHcf(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 0)
			throw new Error('IC10.hcf() expects no arguments');
		this.emit('hcf');
		return null;
	}

	_handleLerp(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 3)
			throw new Error('IC10.lerp() expects 3 arguments');
		const vals = [];
		for (let i = 0; i < 3; i++) {
			const a = args[i];
			if (a.type === 'Literal')
				vals.push(this.convertJsValueToNumber(a.value, `lerp-arg${i}`));
			else {
				const r = this.compileExpressionToReg(a);
				vals.push(r);
				if (this.isTempReg(r))
					this.freeTemp(r); // we'll pass reg or symbol; free temp after using
			}
		}
		const r_ret = this.newTemp();
		this.emit(`lerp ${r_ret} ${vals[0]} ${vals[1]} ${vals[2]}`);
		return r_ret;
	}

	_handleHASH(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('IC10.HASH(s) expects 1 argument');
		const vals = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal' && typeof a.value === 'string') {
				vals.push(a.value);
			} else {
				throw new Error('IC10.HASH(s) expects argument of type string!');
			}
		}
		//const r_ret = this.newTemp();
		//this.emit(`HASH("${vals[0]}")`);
		//return r_ret;
		return `HASH("${vals[0]}")`; //Hack to emit expression as is as an argument for instruction!
	}
}

//handlers for js Math.* functions will be here
class JsMathCallHandlers {
	constructor() {}

	Register(comp) {
		// register Math.* handlers
		comp.registerCallHandler('Math', 'abs', this._handleAbs.bind(comp));
		comp.registerCallHandler('Math', 'acos', this._handleAcos.bind(comp));
		comp.registerCallHandler('Math', 'asin', this._handleAsin.bind(comp));
		comp.registerCallHandler('Math', 'atan', this._handleAtan.bind(comp));
		comp.registerCallHandler('Math', 'atan2', this._handleAtan2.bind(comp));
		comp.registerCallHandler('Math', 'cos', this._handleCos.bind(comp));
		comp.registerCallHandler('Math', 'sin', this._handleSin.bind(comp));
		comp.registerCallHandler('Math', 'tan', this._handleTan.bind(comp));
		comp.registerCallHandler('Math', 'ceil', this._handleCeil.bind(comp));
		comp.registerCallHandler('Math', 'exp', this._handleExp.bind(comp));
		comp.registerCallHandler('Math', 'floor', this._handleFloor.bind(comp));
		comp.registerCallHandler('Math', 'log', this._handleLog.bind(comp));
		comp.registerCallHandler('Math', 'max', this._handleMax.bind(comp));
		comp.registerCallHandler('Math', 'min', this._handleMin.bind(comp));
		comp.registerCallHandler('Math', 'pow', this._handlePow.bind(comp));
		comp.registerCallHandler('Math', 'random', this._handleRandom.bind(comp));
		comp.registerCallHandler('Math', 'round', this._handleRound.bind(comp));
		comp.registerCallHandler('Math', 'sqrt', this._handleSqrt.bind(comp));
		comp.registerCallHandler('Math', 'trunc', this._handleTrunc.bind(comp));
		comp.registerCallHandler('Math', 'cbrt', this._handleCbrt.bind(comp));
	}

	// ----------------  Math handlers (Math.* stuff): ----------------
	_handleAbs(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.abs(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `abs-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`abs ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleAcos(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.acos(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `acos-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`acos ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleAsin(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.asin(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `asin-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`asin ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleAtan(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.atan(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `atan-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`atan ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleAtan2(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 2)
			throw new Error('Math.atan2(y, x) expects 2 arguments'); // note: JS's atan2(y,x) signature
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 2; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `atan2-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`atan2 ${dest} ${compiled[0]} ${compiled[1]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleCos(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.cos(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `cos-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`cos ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleSin(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.sin(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `sin-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`sin ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleTan(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.tan(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `tan-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`tan ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleCeil(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.ceil(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `ceil-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`ceil ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleExp(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.exp(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `exp-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`exp ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleLog(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.log(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `log-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`log ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleFloor(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.floor(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `floor-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`floor ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}
	/*
	_handleMax(compiler, callNode) {
	const args = callNode.arguments || [];
	if (args.length !== 2) throw new Error('Math.max(x) expects 2 arguments');
	// compile both args (can be literal, const symbol or reg)
	const compiled = [];
	for (let i=0;i<2;i++) {
	const a = args[i];
	if (a.type === 'Literal') {
	compiled.push(this.convertJsValueToNumber(a.value, `max-arg${i}`));
	} else {
	const r = this.compileExpressionToReg(a);
	compiled.push(r);
	}
	}
	// ensure we use registers/symbols correctly - allocate dest temp
	const dest = this.newTemp();
	this.emit(`max ${dest} ${compiled[0]} ${compiled[1]}`);
	// free temps for arg registers (if they were temps)
	for (const arg of compiled) if (this.isTempReg(arg)) this.freeTemp(arg);
	return dest;
	}

	_handleMin(compiler, callNode) {
	const args = callNode.arguments || [];
	if (args.length !== 2) throw new Error('Math.min(x) expects 2 arguments');
	// compile both args (can be literal, const symbol or reg)
	const compiled = [];
	for (let i=0;i<2;i++) {
	const a = args[i];
	if (a.type === 'Literal') {
	compiled.push(this.convertJsValueToNumber(a.value, `min-arg${i}`));
	} else {
	const r = this.compileExpressionToReg(a);
	compiled.push(r);
	}
	}
	// ensure we use registers/symbols correctly - allocate dest temp
	const dest = this.newTemp();
	this.emit(`min ${dest} ${compiled[0]} ${compiled[1]}`);
	// free temps for arg registers (if they were temps)
	for (const arg of compiled) if (this.isTempReg(arg)) this.freeTemp(arg);
	return dest;
	}
	 */

	_handleMax(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length === 0)
			throw new Error('Math.max requires at least one argument');

		const compileArg = (a) => {
			if (a.type === 'Literal')
				return this.convertJsValueToNumber(a.value, 'max-arg');
			return this.compileExpressionToReg(a);
		};

		// start with first argument
		let current = compileArg(args[0]);

		// if single arg — return it (make a temp if it's a raw number)
		if (args.length === 1) {
			if (typeof current === 'number') {
				const t = this.newTemp();
				this.emit(`move ${t} ${current}`);
				return t;
			}
			return current;
		}

		// fold remaining args: current = max(current, next)
		for (let i = 1; i < args.length; i++) {
			const next = compileArg(args[i]);

			const currentIsTemp = this.isTempReg(current);
			const nextIsTemp = this.isTempReg(next);

			// choose destination: prefer reusing a temp operand
			let dest = null;
			if (nextIsTemp)
				dest = next;
			else if (currentIsTemp)
				dest = current;
			else
				dest = this.newTemp();

			this.emit(`max ${dest} ${current} ${next}`);

			// free operand temps that are not reused as dest
			if (current !== dest && this.isTempReg(current))
				this.freeTemp(current);
			if (next !== dest && this.isTempReg(next))
				this.freeTemp(next);

			current = dest;
		}

		return current;
	}

	_handleMin(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length === 0)
			throw new Error('Math.min requires at least one argument');

		const compileArg = (a) => {
			if (a.type === 'Literal')
				return this.convertJsValueToNumber(a.value, 'min-arg');
			return this.compileExpressionToReg(a);
		};

		// start with first argument
		let current = compileArg(args[0]);

		// if single arg — return it (make a temp if it's a raw number)
		if (args.length === 1) {
			if (typeof current === 'number') {
				const t = this.newTemp();
				this.emit(`move ${t} ${current}`);
				return t;
			}
			return current;
		}

		// fold remaining args: current = min(current, next)
		for (let i = 1; i < args.length; i++) {
			const next = compileArg(args[i]);

			const currentIsTemp = this.isTempReg(current);
			const nextIsTemp = this.isTempReg(next);

			// choose destination: prefer reusing a temp operand
			let dest = null;
			if (nextIsTemp)
				dest = next;
			else if (currentIsTemp)
				dest = current;
			else
				dest = this.newTemp();

			this.emit(`min ${dest} ${current} ${next}`);

			// free operand temps that are not reused as dest
			if (current !== dest && this.isTempReg(current))
				this.freeTemp(current);
			if (next !== dest && this.isTempReg(next))
				this.freeTemp(next);

			current = dest;
		}

		return current;
	}

	_handlePow(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 2)
			throw new Error('Math.pow(x) expects 2 arguments');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 2; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `pow-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`pow ${dest} ${compiled[0]} ${compiled[1]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleRandom(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 0)
			throw new Error('Math.random() expects no arguments');
		const r_ret = this.newTemp();
		this.emit(`rand ${r_ret}`);
		return r_ret;
	}

	_handleRound(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.round(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `round-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`round ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleSqrt(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.sqrt(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `sqrt-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`sqrt ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleTrunc(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.trunc(x) expects single argument');
		// compile both args (can be literal, const symbol or reg)
		const compiled = [];
		for (let i = 0; i < 1; i++) {
			const a = args[i];
			if (a.type === 'Literal') {
				compiled.push(this.convertJsValueToNumber(a.value, `trunc-arg${i}`));
			} else {
				const r = this.compileExpressionToReg(a);
				compiled.push(r);
			}
		}
		// ensure we use registers/symbols correctly - allocate dest temp
		const dest = this.newTemp();
		this.emit(`trunc ${dest} ${compiled[0]}`);
		// free temps for arg registers (if they were temps)
		for (const arg of compiled)
			if (this.isTempReg(arg))
				this.freeTemp(arg);
		return dest;
	}

	_handleCbrt(compiler, callNode) {
		const args = callNode.arguments || [];
		if (args.length !== 1)
			throw new Error('Math.cbrt(x) expects exactly 1 argument');
		const aNode = args[0];

		// compile-time literal -> fold
		if (aNode.type === 'Literal') {
			const val = this.convertJsValueToNumber(aNode.value, 'cbrt-lit');
			const folded = Math.cbrt(val);
			const t = this.newTemp();
			this.emit(`move ${t} ${folded}`);
			return t;
		}

		// compile argument to a reg or symbol
		let aVal = this.compileExpressionToReg(aNode);
		// if it's a const symbol with numeric value, fold at compile-time
		if (typeof aVal === 'string' && !/^r\d+$/.test(aVal) && this.consts.has(aVal)) {
			const folded = Math.cbrt(this.consts.get(aVal));
			const t = this.newTemp();
			this.emit(`move ${t} ${folded}`);
			return t;
		}

		// Ensure we have a stable register for the input 'a' (aReg).
		// If aVal is a symbol (const name), keep it as a symbol (no copy).
		// If aVal is a register (var or temp), copy it into a dedicated temp aReg we own.
		let aReg = aVal;
		if (!(typeof aVal === 'string' && !/^r\d+$/.test(aVal))) {
			// aVal is a register; copy into our temp aReg so it won't be overwritten.
			aReg = this.newTemp();
			this.emit(`move ${aReg} ${aVal}`);
			if (this.isTempReg(aVal))
				this.freeTemp(aVal); // free original temp if it was one
		}

		// Prepare result register (x) which will hold iterative value and final result.
		const result = this.newTemp();

		// Zero-check: if aReg == 0 -> result = 0 and jump to end
		const zeroTmp = this.newTemp();
		this.emit(`seq ${zeroTmp} ${aReg} 0`); // zeroTmp = (aReg == 0) ? 1 : 0
		const contLabel = this.newLabel('cbrt_cont');
		const endLabel = this.newLabel('cbrt_end');
		// If zeroTmp == 0 => not zero -> continue
		this.emit(`beq ${zeroTmp} 0 ${contLabel}`);

		// zero-case: set result = 0 and jump to end
		this.emit(`move ${result} 0`);
		this.emit(`j ${endLabel}`);

		// non-zero path
		this.emit(`${contLabel}:`);
		this.freeTemp(zeroTmp);

		// initial x = aReg
		this.emit(`move ${result} ${aReg}`);

		// iteration counter (keep separate register; never reuse aReg)
		const cnt = this.newTemp();
		const ITER = 5; // trade-off: 5 iterations is usually enough
		this.emit(`move ${cnt} ${ITER}`);

		const loopLabel = this.newLabel('cbrt_loop');
		this.emit(`${loopLabel}:`);

		// x2 = x * x
		const x2 = this.newTemp();
		this.emit(`mul ${x2} ${result} ${result}`);

		// t1 = a / x2
		const t1 = this.newTemp();
		this.emit(`div ${t1} ${aReg} ${x2}`);

		// t2 = 2 * x  (add x x)
		const t2 = this.newTemp();
		this.emit(`add ${t2} ${result} ${result}`);

		// t3 = t2 + t1
		const t3 = this.newTemp();
		this.emit(`add ${t3} ${t2} ${t1}`);

		// result = t3 / 3
		this.emit(`div ${result} ${t3} 3`);

		// free intermediates
		this.freeTemp(x2);
		this.freeTemp(t1);
		this.freeTemp(t2);
		this.freeTemp(t3);

		// decrement counter and loop
		this.emit(`sub ${cnt} ${cnt} 1`);
		this.emit(`beq ${cnt} 0 ${endLabel}`);
		this.emit(`j ${loopLabel}`);

		// end label
		this.emit(`${endLabel}:`);
		// free counter
		if (this.isTempReg(cnt))
			this.freeTemp(cnt);

		// aReg: if we created it as a temp above, free it (but only after loop done)
		if (this.isTempReg(aReg) && aReg !== result)
			this.freeTemp(aReg);

		// result holds the cbrt (or 0)
		return result;
	}
}
