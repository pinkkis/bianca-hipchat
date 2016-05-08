'use strict';

const EventEmitter = require('events');
const Client = require('node-xmpp-client');
const logger = require('../modules/logger');
const uuid = require('uuid');

class Bot extends EventEmitter {
	constructor(options) {
		super();

		this.options = options || {};

		this.keepAliveTime = this.options.keepAliveTime || 60000;
		this.rooms = [];
		this.profile = null;
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
		// TODO ignore messages from ourselves

		//logger.info(`stanza: ${stanza}`);
		if (stanza.attrs.type === 'error') {
			this.handleErrorStanza(stanza);
		}

		if (stanza.is('iq')) {
			this.handleIqStanza(stanza);
		}

		if (stanza.is('presence')) {
			this.handlePresenceStanza(stanza);
		}

		if (stanza.is('message')) {
			this.handleMessageStanza(stanza);
		}
	}

	onError(e) {
		logger.error(e);
	}

	onOnline() {
		logger.info('Client connected');

		this.setAvailability('chat', `I'm alive!`);

		this.emit('connected');

		let profile = this.requestProfile().then((resp) => this.onProfileResult);
		let rooms = this.requestRooms().then((resp) => this.onRoomsResult);
		let roster = this.requestRoster().then((resp) => this.onRosterResult);

		this.keepAlive = setInterval(() => {
			if (this.client.connection.connected) {
				logger.info('Sending keepalive');
				this.client.send((' '));
			} else {
				clearInterval(this.keepAlive);
			}

		}, this.keepAliveTime);
	}

	onProfileResult(stanza) {
		logger.info(`Profile response: ${stanza.toString()}`);
	}

	onRoomsResult(stanza) {
		logger.info(`Rooms response: ${stanza.toString()}`);
	}

	onRosterResult(stanza) {
		logger.info(`Roster response: ${stanza.toString()}`);
	}

	handleIqStanza(stanza) {
		if (stanza.attrs.id) {
			return this.emit(`id:${stanza.attrs.id}`, stanza);
		}

		// TODO
		logger.debug(`IQ: ${stanza.toString()}`);
	}

	handlePresenceStanza(stanza) {
		logger.debug(`presence stanza: ${stanza.toString()}`);
	}

	handleMessageStanza(stanza) {
		stanza.attrs.to = stanza.attrs.from;
		delete stanza.attrs.from;

		logger.info(`Responding to ${stanza.attrs.to} with an echo`);
		this.client.send(stanza);
	}

	handleErrorStanza(stanza) {
		logger.warn(`Error stanza: ${stanza.toString()}`);
	}

	/**
	 * Post a message to a target room or user
	 */
	postMessage(to, message) {
		let stanza = new Client.Stanza('message', { to: to, type: 'chat' })
			.c('body').t(message);
		this.client.send(stanza);
	}

	sendQuery(stanza) {
		let guid = uuid.v1();
		stanza = stanza.root();
		stanza.attrs.id = stanza.attrs.id || guid;
		let result = new Promise((resolve, reject) => {
			this.once(`id:${guid}`, (response) => {
				resolve(response);
			});
		});

		this.client.send(stanza);

		return result;
	}

	/**
	 * Set your availability and status message
	 */
	setAvailability(availability, status) {
		let stanza = new Client.Stanza('presence', { type: 'available' })
			.c('show').t(availability).up()
			.c('status').t(status)
			.c('c', {
				xmlns: 'http://jabber.org/protocol/caps',
				node: 'http://hipchat.com/client/bot', // tell HipChat we're a bot
				ver: 1
			});

		this.client.send(stanza);
	}

	/**
	 * Requets your profile info
	 */
	requestProfile() {
		// vcard query
		let stanza = new Client.Stanza('iq', { type: 'get'})
			.c('vCard', { xmlns: 'vcard-temp' });

		return this.sendQuery(stanza);
	}

	/**
	 * Requets a full roster
	 */
	requestRoster() {
		let stanza = new Client.Stanza('iq', { type: 'get' })
			.c('query', { xmlns: 'jabber:iq:roster' });


		// this.sendIq(iq, function(err, stanza) {
		//   var rosterItems = [];
		//   if (!err) {
		//     // parse response into objects
		//     stanza.getChild('query').getChildren('item').map(function(el) {
		//       rosterItems.push({
		//         jid: el.attrs.jid,
		//         name: el.attrs.name,
		//         // name used to @mention this user
		//         mention_name: el.attrs.mention_name,
		//       });
		//     });
		//   }
		//   callback(err, rosterItems, stanza);
		// });


		return this.sendQuery(stanza);
	}

	/**
	 * Request all rooms
	 */
	requestRooms() {
		let stanza = new Client.Stanza('iq', { to: this.options.mucHost, type: 'get' })
			.c('query', { xmlns: 'http://jabber.org/protocol/disco#items' });

		// this.sendIq(iq, function(err, stanza) {
		//   var rooms = [];
		//   if (!err) {
		//     // parse response into objects
		//     stanza.getChild('query').getChildren('item').map(function(el) {
		//       var x = el.getChild('x', 'http://hipchat.com/protocol/muc#room');
		//       rooms.push({
		//         jid: el.attrs.jid,
		//         name: el.attrs.name,
		//         id: parseInt(x.getChild('id').getText()),
		//         topic: x.getChild('topic').getText(),
		//         privacy: x.getChild('privacy').getText(),
		//         owner: x.getChild('owner').getText(),
		//         num_participants:
		//           parseInt(x.getChild('num_participants').getText()),
		//         guest_url: x.getChild('guest_url').getText(),
		//         is_archived: x.getChild('is_archived') ? true : false
		//       });
		//     });
		//   }
		//   callback(err, rooms, stanza);
		// });

		return this.sendQuery(stanza);
	}

	/**
	 * Join room
	 * - `roomJid`: Target room, in the form of `????_????@conf.hipchat.com`
	 * - `historyStanzas`: how many lines of history to get upon joining
	 */
	joinRoom(roomJid, historyStanzas) {
		let stanza = new Client.Stanza();
		if (!historyStanzas) {
			historyStanzas = 0;
		}
		var packet = new xmpp.Element('presence', { to: roomJid + '/' + this.name });
		packet.c('x', { xmlns: 'http://jabber.org/protocol/muc' })
			.c('history', {
				xmlns: 'http://jabber.org/protocol/muc',
				maxstanzas: String(historyStanzas)
			});
		this.jabber.send(packet);
		this.client.send(stanza);
	}


	/**
	 * Leave a room
	 * - `roomJid`: Target room, in the form of `????_????@conf.hipchat.com`
	 */
	partRoom(roomJid) {
		var stanza = new Client.Stanza('presence', { type: 'unavailable', to: roomJid + '/' + this.name });
		stanza.c('x', { xmlns: 'http://jabber.org/protocol/muc' });
		stanza.c('status').t('hc-leave');
		this.client.send(stanza);
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
