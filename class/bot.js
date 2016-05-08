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
		this.roster = [];
		this.presences = [];
		this.profile = null;
		this.serverData = null;
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
		logger.error('onError', e);
	}

	onOnline() {
		logger.info('Client connected');

		this.setAvailability('chat', `I'm alive!`);

		this.emit('connected');

		let startupData = this.getStartupData().then(resp => this.onStartupDataResult(resp));
		//let profile = this.requestProfile().then(resp => this.onProfileResult(resp));
		let rooms = this.requestRooms().then(resp => this.onRoomsResult(resp));
		let roster = this.requestRoster().then(resp => this.onRosterResult(resp));

		this.keepAlive = setInterval(() => {
			if (this.client.connection.connected) {
				logger.debug('Keepalive');
				this.client.send((' '));
			} else {
				clearInterval(this.keepAlive);
			}

		}, this.keepAliveTime);
	}

	onProfileResult(stanza) {
		logger.info('Profile response', stanza.toString());
	}

	onRoomsResult(stanza) {
		this.rooms = [];

		stanza
			.getChild('query')
			.getChildren('item')
			.map((room, i, a) => {
				let x = room.getChild('x', 'http://hipchat.com/protocol/muc#room');
				this.rooms.push({
					jid: room.attrs.jid,
					name: room.attrs.name,
					id: parseInt(x.getChild('id').getText()),
					topic: x.getChild('topic').getText(),
					privacy: x.getChild('privacy').getText(),
					owner: x.getChild('owner').getText(),
					num_participants: parseInt(x.getChild('num_participants').getText()),
					guest_url: x.getChild('guest_url').getText(),
					is_archived: x.getChild('is_archived') ? true : false
				});
			});

		this.emit('roomsUpdate', this.rooms);
		logger.info(`Rooms updated with ${this.rooms.length} rooms`);
		logger.silly('Rooms stanza', stanza.toString());
	}

	onRosterResult(stanza) {
		this.roster = [];

		stanza
			.getChild('query')
			.getChildren('item')
			.map((user, i, a) => {
				this.roster.push({
					jid: user.attrs.jid,
					name: user.attrs.name,
					mention_name: user.attrs.mention_name
				});
			});

		this.emit('rosterUpdate', this.roster);
		logger.info(`Roster updated with ${this.roster.length} users`);
		logger.silly('Roster stanza', stanza.toString());
	}

	onStartupDataResult(stanza) {
		this.serverData = this.serverData || {};
		let data = {};

		let query = stanza.getChild('query');
		let preferences = query.getChild('preferences');

		// get user details into separate profile object
		this.profile = data.user_id = parseInt(query.getChild('user_id').getText());
		this.profile = data.email = query.getChild('email').getText();
		this.profile = data.mention_name = query.getChild('mention_name').getText();
		this.profile = data.name = query.getChild('name').getText();
		this.profile = data.photo_large = query.getChild('photo_large').getText();
		this.profile = data.photo_small = query.getChild('photo_small').getText();
		this.profile = data.title = query.getChild('title').getText();
		this.profile = data.is_admin = query.getChild('is_admin').getText();

		data.group_id = parseInt(query.getChild('group_id').getText());
		data.group_name = query.getChild('group_name').getText();
		data.group_uri_domain = query.getChild('group_uri_domain').getText();
		data.group_invite_url = query.getChild('group_invite_url').getText();
		data.group_avatar_url = query.getChild('group_avatar_url').getText();
		data.group_absolute_avatar_url = query.getChild('group_absolute_avatar_url').getText();

		data.token = query.getChild('token').getText();
		data.addlive_app_id = query.getChild('addlive_app_id').getText();
		data.plan = query.getChild('plan').getText();

		data.autojoin = [];

		preferences
			.getChild('autoJoin')
			.getChildren('item')
			.map((room, i, a) => {
				let x = room.getChild('x', 'http://hipchat.com/protocol/muc#room');

				// list includes rooms and 1-1 convos
				if (x) {
					data.autojoin.push({
						jid: room.attrs.jid,
						name: room.attrs.name,
						id: parseInt(x.getChild('id').getText()),
						topic: x.getChild('topic').getText(),
						privacy: x.getChild('privacy').getText(),
						owner: x.getChild('owner').getText(),
						num_participants: parseInt(x.getChild('num_participants').getText())
					});
				} else {
					data.autojoin.push({
						jid: room.attrs.jid
					});
				}
			});

		Object.assign(this.serverData, data);
		logger.info('Received Startup data, including user profile.', this.serverData);
		this.emit('profile', this.profile);
		this.emit('startup', this.serverData);
	}

	handleIqStanza(stanza) {
		if (stanza.attrs.id) {
			return this.emit(`id:${stanza.attrs.id}`, stanza);
		}

		// TODO what if it doesn't have an id
		logger.debug('IQ', stanza.toString());
	}

	handlePresenceStanza(stanza) {
		let presence = {};
		let show = stanza.getChild('show');
		let x = stanza.getChild('x');

		presence.user = stanza.attrs.from;
		presence.type = stanza.attrs.type;
		presence.show = null;
		presence.client_type = null;

		if (show) {	presence.show = show.getText(); }
		if (x) { presence.client_type = x.getChild('client_type').getText(); }

		let idx = this.presences.map((p) => {
					return p.user;
				}).indexOf(presence.user);

		if (idx < 0) {
			this.presences.push(presence);
		} else {
			this.presences[idx] = presence;
		}

		logger.debug(`Presence updated for ${presence.user}`);
	}

	handleMessageStanza(stanza) {
		stanza.attrs.to = stanza.attrs.from;
		delete stanza.attrs.from;

		logger.info(`Responding to ${stanza.attrs.to} with an echo.`, stanza.toString());
		this.client.send(stanza);
	}

	handleErrorStanza(stanza) {
		logger.warn('Error stanza', stanza.toString());
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
	 * Startup query
	 */
	getStartupData() {
		let stanza = new Client.Stanza('iq', { to: this.options.mucHost, type: 'get' })
			.c('query', { xmlns: 'http://hipchat.com/protocol/startup', send_auto_join_user_presences: true });

		return this.sendQuery(stanza);
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
		let stanza = new Client.Stanza('iq', { type: 'get' })
			.c('vCard', { xmlns: 'vcard-temp' });

		return this.sendQuery(stanza);
	}

	/**
	 * Requets a full roster
	 */
	requestRoster() {
		let stanza = new Client.Stanza('iq', { type: 'get' })
			.c('query', { xmlns: 'jabber:iq:roster' });

		return this.sendQuery(stanza);
	}

	/**
	 * Request all rooms
	 */
	requestRooms() {
		let stanza = new Client.Stanza('iq', { to: this.options.mucHost, type: 'get' })
			.c('query', { xmlns: 'http://jabber.org/protocol/disco#items' });

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

module.exports = Bot;
