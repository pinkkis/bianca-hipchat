'use strict';

const EventEmitter = require('events');

class AppComm extends EventEmitter {
	constructor() {
		super();

		this.components = {
			bot: null,
			express: null,
			socket: null
		};
	}

	get bot() {
		return this.components.bot;
	}
	set bot(val) {
		this.components.bot = val;
	}

	get express() {
		return this.components.express;
	}
	set express(val) {
		this.components.express = val;
	}

	get socket() {
		return this.components.socket;
	}
	set socket(va) {
		this.components.socket = val;
	}
}

module.exports = AppComm;