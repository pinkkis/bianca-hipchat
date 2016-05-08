'use strict';

class Message {
	constructor(type, body, from, to) {
		this.type = type || null;
		this.body = body || null;
		this.from = from || null;
		this.to = to || null;

		this.channel = null;
	}

	addChannel(channel) {
		this.channel = channel;
	}
}

module.exports = Message;