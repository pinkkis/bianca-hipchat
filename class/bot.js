'use strict';

const EventEmitter = require('events');
const Client = require('node-xmpp-client');
const logger = require('../modules/logger');

class Bot extends EventEmitter {
	constructor(options) {
		super();

		this.options = options || {};

		this.keepAliveTime = this.options.keepAliveTime || 60000;
	}

	connect() {
		this.client = new Client(this.options);

		this.client
			.on('online', this.onOnline.bind(this))
			.on('stanza', this.onStanza.bind(this))
			.on('error', this.onError.bind(this))
			.on('disconnect', this.onDisconnect.bind(this))
			.on('reconnect', this.onReconnect.bind(this))
			.on('offline', this.onOffline.bind(this));
	}

	onDisconnect(error) {
		this.emit('disconnected', error);
		logger.warn(`Client disconnected: ${error}, ${this.client.connection.reconnect}`);
	}

	onReconnect() {
		this.emit('reconnecting');
		logger.info('Client reconnecting');
	}

	onOffline() {
		this.emit('offline');
		logger.info('Client offline');
	}

	onStanza(stanza) {
		//logger.info(`stanza: ${stanza}`);

		if (stanza.is('iq')) {
			logger.warn(`iq: ${stanza}`);
		}

		if (stanza.is('presence')) {
			logger.debug(`presence stanza: ${stanza}`);
		}

		if (stanza.is('message') && stanza.attrs.type !== 'error') {
			stanza.attrs.to = stanza.attrs.from;
			delete stanza.attrs.from;

			logger.info(`Responding to ${stanza.attrs.to} with an echo`);
			this.client.send(stanza);
		}
	}

	onError(e) {
		logger.error(e);
	}

	onOnline() {
		logger.info('Client connected');
		this.client.send(
			new Client.Stanza('presence', {})
				.c('show').t('chat').up()
				.c('status').t('This is my status message')
		);

		this.emit('connected');

		let profile = this.getProfile();

		this.keepAlive = setInterval(() => {
			if (this.client.connection.connected) {
				logger.info('Sending keepalive');
				this.client.send((' '));
			} else {
				clearInterval(this.keepAlive);
			}

		}, this.keepAliveTime);
	}

	postMessage(to, message) {
		let stanza = new Client.Stanza('message', { to: to, type: 'chat' })
			.c('body').t(message);
		this.client.send(stanza);
	}




	getProfile() {
		let profileInfo = new Promise((resolve, reject) => {
			let stanza = new Client.Stanza('iq', { type: 'get' })
				.c('vCard', { xmlns: 'vcard-temp' });

			console.log(stanza.toString());

			this.client.send(stanza);

			resolve({});
		});


		return profileInfo;
	}

}

//   Bot.prototype.getProfile = function(callback) {
//     var stanza = new xmpp.Element('iq', { type: 'get' })
//                  .c('vCard', { xmlns: 'vcard-temp' });
//     this.sendIq(stanza, function(err, response) {
//       var data = {};
//       if (!err) {
//         var fields = response.getChild('vCard').children;
//         fields.forEach(function(field) {
//           data[field.name.toLowerCase()] = field.getText();
//         });
//       }
//       callback(err, data, response);
//     });
//   };


module.exports = Bot;
