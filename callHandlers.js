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
		let aRef = this.compileExpressionToReg(aNode);
		// if it's a symbol (const name) but we have its numeric value, fold at compile-time
		if (typeof aRef === 'string' && !/^r\d+$/.test(aRef) && this.consts.has(aRef)) {
			const folded = Math.cbrt(this.consts.get(aRef));
			const t = this.newTemp();
			this.emit(`move ${t} ${folded}`);
			return t;
		}

		// ensure we have a stable aRef we own (either a symbol name or a temp we will keep)
		// If compileExpressionToReg returned a temp or var reg, move into a temp holder so we can safely use original value repeatedly
		if (!(typeof aRef === 'string' && !/^r\d+$/.test(aRef))) {
			// aRef is a register (temp or var). Move into a temp we control.
			const holder = this.newTemp();
			this.emit(`move ${holder} ${aRef}`);
			// if original was a temp, free it
			if (this.isTempReg(aRef))
				this.freeTemp(aRef);
			aRef = holder;
		}

		// runtime zero-check: if aRef == 0 -> return 0 (avoid divide by zero)
		const zeroTmp = this.newTemp();
		this.emit(`seq ${zeroTmp} ${aRef} 0`);
		const contLabel = this.newLabel('cbrt_cont');
		const endLabel = this.newLabel('cbrt_end');
		// if zeroTmp == 0 -> continue; else (non-zero?) seq returns 1 when equal,
		// so if equal (tmp != 0) we should return zero. We test tmp == 0 to jump to cont.
		this.emit(`beq ${zeroTmp} 0 ${contLabel}`);
		// zero case: produce zero result register and jump to end
		const zeroRes = this.newTemp();
		this.emit(`move ${zeroRes} 0`);
		this.emit(`j ${endLabel}`);
		// continue with Newton iterations
		this.emit(`${contLabel}:`);
		// free zeroTmp now
		this.freeTemp(zeroTmp);

		// initial guess x = aRef (in a temp)
		const x = this.newTemp();
		this.emit(`move ${x} ${aRef}`);

		// choose number of iterations (6 is more than enough for double precision)
		const ITER = 6;
		for (let i = 0; i < ITER; i++) {
			// x2 = x * x
			const x2 = this.newTemp();
			this.emit(`mul ${x2} ${x} ${x}`);
			// t1 = aRef / x2
			const t1 = this.newTemp();
			this.emit(`div ${t1} ${aRef} ${x2}`);
			// t2 = 2 * x  (use add x x to avoid immediate-mul variants)
			const t2 = this.newTemp();
			this.emit(`add ${t2} ${x} ${x}`);
			// t3 = t2 + t1
			const t3 = this.newTemp();
			this.emit(`add ${t3} ${t2} ${t1}`);
			// x = t3 / 3  (reuse x as destination)
			this.emit(`div ${x} ${t3} 3`);
			// free temps we no longer need
			this.freeTemp(x2);
			this.freeTemp(t1);
			this.freeTemp(t2);
			this.freeTemp(t3);
			// x remains (either reused dest or temp)
		}

		// result in x
		const result = x;

		// cleanup: free aRef if it was a temp we created
		if (this.isTempReg(aRef))
			this.freeTemp(aRef);

		this.emit(`${endLabel}:`);
		// If we jumped to end via zero-case, zeroRes exists; otherwise result holds value.
		// We must decide which register holds valid result at end:
		// - if zero-case executed, code jumped to end with zeroRes assigned
		// - else result (x) holds computed value.
		// To unify, if zeroRes exists, pick a final register to return:
		// Check: zeroRes exists only when we emitted it. We'll return whichever register is defined.
		// For simplicity: if zeroRes is defined above, return it; otherwise return result.
		// (zeroRes is defined in this scope.)
		if (typeof zeroRes !== 'undefined') {
			// if result is same as zeroRes, fine; else free result if temp and return zeroRes
			if (result !== zeroRes) {
				if (this.isTempReg(result))
					this.freeTemp(result);
			}
			return zeroRes;
		}
		return result;
	}
}
