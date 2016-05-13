'use strict';

const EventEmitter = require('events');
const Xmpp = require('node-xmpp-client');
const logger = require('../modules/logger');
const uuid = require('uuid');

class Hipchat extends EventEmitter {
	constructor(options) {
		super();

		this.options = options || {};

		this.keepAliveTime = this.options.keepAliveTime || 60000;
		this.rooms = [];
		this.roster = [];
		this.presences = [];
		this.profile = null;
		this.serverData = null;

		this.emit('created');
	}

	/**
	 * Connectes client and sets up client events
	 */
	connect() {
		this.client = new Xmpp(this.options);

		this.client
			.on('online', this.onOnline.bind(this))
			.on('stanza', this.onStanza.bind(this))
			.on('error', this.onError.bind(this))
			.on('disconnect', this.onDisconnect.bind(this))
			.on('reconnect', this.onReconnect.bind(this))
			.on('offline', this.onOffline.bind(this));
	}

	/**
	 * Disconnected event handler
	 */
	onDisconnect(error) {
		this.emit('disconnected', error);
		logger.warn(`Client disconnected: ${error}, ${this.client.connection.reconnect}`);
	}

	/**
	 * Reconnecting event handler
	 */
	onReconnect() {
		this.emit('reconnecting');
		logger.info('Client reconnecting');
	}

	/**
	 * Offline handler
	 */
	onOffline() {
		this.emit('offline');
		logger.info('Client offline');
	}

	onStanza(stanza) {
		//logger.info('stanza', stanza);

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

	/**
	 * Generic error handler
	 */
	onError(e) {
		this.emit('error', e);
		logger.error('onError', e);
	}

	/**
	 * Online event handler
	 * called every time the client connects
	 */
	onOnline() {
		logger.info('Client connected');

		this.setAvailability('chat', `I'm alive!`);

		this.emit('connected');

		let startupData = this.getStartupData().then(resp => this.onStartupDataResult(resp));
		let rooms = this.requestRooms().then(resp => this.onRoomsResult(resp));
		let roster = this.requestRoster().then(resp => this.onRosterResult(resp));
		//let profile = this.requestProfile().then(resp => this.onProfileResult(resp));

		this.startKeepAlive();
	}

	startKeepAlive() {
		this.keepAlive = setInterval(() => {
			if (this.client.connection.connected) {
				logger.debug('Keepalive');
				this.client.send((' '));
			} else {
				clearInterval(this.keepAlive);
			}

		}, this.keepAliveTime);
	}

	/**
	 * Handle Profile responses
	 * Todo: startup already handles this, and the format is different in vCard here
	 */
	onProfileResult(stanza) {
		logger.info('Profile response', stanza.toString());
	}

	/**
	 * Handle Room updates
	 */
	onRoomsResult(stanza) {
		this.rooms = [];

		stanza
			.getChild('query')
			.getChildren('item')
			.map((room, i, a) => {
				let x = room.getChild('x', 'http://hipchat.com/protocol/muc#room');
				this.rooms.push({
					jid: new Xmpp.JID(room.attrs.jid),
					name: room.attrs.name,
					id: parseInt(x.getChildText('id')),
					topic: x.getChildText('topic'),
					privacy: x.getChildText('privacy'),
					owner: x.getChildText('owner'),
					num_participants: parseInt(x.getChildText('num_participants')),
					guest_url: x.getChildText('guest_url'),
					is_archived: x.getChild('is_archived') ? true : false
				});
			});

		this.emit('roomsUpdate', this.rooms);
		logger.info(`Rooms updated with ${this.rooms.length} rooms`);
		logger.silly('Rooms stanza', stanza.toString());
	}

	/**
	 * Handle Roster updates
	 */
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

	/**
	 * Process Startup response data
	 */
	onStartupDataResult(stanza) {
		this.serverData = this.serverData || {};
		let data = {};

		let query = stanza.getChild('query');
		let preferences = query.getChild('preferences');

		// get user details into separate profile object
		this.profile = this.profile || {};
		this.profile.user_id = data.user_id = parseInt(query.getChild('user_id').getText());
		this.profile.email = data.email = query.getChild('email').getText();
		this.profile.mention_name = data.mention_name = query.getChild('mention_name').getText();
		this.profile.name = data.name = query.getChild('name').getText();
		this.profile.photo_large = data.photo_large = query.getChild('photo_large').getText();
		this.profile.photo_small = data.photo_small = query.getChild('photo_small').getText();
		this.profile.title = data.title = query.getChild('title').getText();
		this.profile.is_admin = data.is_admin = query.getChild('is_admin').getText();

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
						jid: new Xmpp.JID(room.attrs.jid),
						name: room.attrs.name,
						id: parseInt(x.getChildText('id')),
						topic: x.getChildText('topic'),
						privacy: x.getChildText('privacy'),
						owner: x.getChildText('owner'),
						num_participants: parseInt(x.getChildText('num_participants'))
					});
				}
			});

		this.profile.jid = new Xmpp.JID(data.group_id + '_' + data.user_id, this.options.host, null);

		Object.assign(this.serverData, data);
		logger.info('Received Startup data, including user profile.', this.serverData);
		this.emit('profile', this.profile);
		this.emit('startup', this.serverData);

		this.serverData.autojoin.forEach((room) => {
			this.joinRoom(room.jid);
		});
	}

	/**
	 * Handles IQ responses by emitting them back to the handler
	 */
	handleIqStanza(stanza) {
		if (stanza.attrs.id) {
			return this.emit(`id:${stanza.attrs.id}`, stanza);
		}

		// TODO what if it doesn't have an id
		logger.debug('IQ', stanza.toString());
	}

	/**
	 * Handle presence stanzas
	 */
	handlePresenceStanza(stanza) {
		let presence = {};
		let show = stanza.getChild('show');
		let x = stanza.getChild('x');

		presence.user = new Xmpp.JID(stanza.attrs.from);
		presence.type = stanza.attrs.type;
		presence.show = null;
		presence.client_type = null;

		if (show) { presence.show = show.getText(); }
		if (x) {
			let client_type = x.getChild('client_type');
			if (client_type) {
				presence.client_type = client_type.getText();
			}
		}

		let idx = this.presences.map((p) => {
			return p.user;
		}).indexOf(presence.user);

		if (idx < 0) {
			this.presences.push(presence);
		} else {
			this.presences[idx] = presence;
		}

		logger.debug(`Presence updated for ${presence.user.toString()}`);
		this.emit('presenceUpdate', presence);
	}

	/**
	 * Handle message type stanzas
	 */
	handleMessageStanza(stanza) {
		let message = this.parseMessageStanza(stanza);

		logger.info('Received message', message);

		if (message.isCommand) {
			this.emit('botCommand', message);
		}

		if (message.type === 'chat') {
			this.emit('privateMessage', message);
		}

		if (message.type === 'groupchat') {
			this.emit('groupMessage', message);
		}

		if (message.isChannelMessage) {
			this.emit('channelMessage', message);
		}

		if (message.hasAtMention && !message.isCommand) {
			this.emit('atMention', message);
		}

		if (message.hasNameMention && !message.isCommand) {
			this.emit('nameMention', message);
		}

		if (message.hasChannelMention) {
			this.emit('channelMention', message);
		}

		this.emit('message', message);
	}

	parseMessageStanza(stanza) {
		let message = {};

		let linkPostRegEx = /\/link$/i;
		let commandRegEx = new RegExp('^(?:@'+ this.profile.mention_name +'\\s)?!(\\w+)\\s?(.*)?', 'i');
		let channelMentionRegEx = /\@all|@here/ig;
		let nameMentionRegEx = new RegExp(this.profile.name, 'i');
		let atMentionRegEx = new RegExp('@' + this.profile.mention_name, 'i');

		message.from = new Xmpp.JID(stanza.attrs.from);
		message.to = new Xmpp.JID(stanza.attrs.to);
		message.isLinkPost = linkPostRegEx.test(stanza.attrs.from);
		message.body = stanza.getChildText('body');
		message.type = stanza.attrs.type;
		message.subject = stanza.getChildText('subject');
		message.isChannelMessage = message.subject && stanza.attrs.type === 'groupchat';
		message.hasNameMention = nameMentionRegEx.test(message.body);
		message.hasAtMention = atMentionRegEx.test(message.body);
		message.hasChannelMention = channelMentionRegEx.test(message.body);
		message.channel = message.type === 'groupchat' ? message.from.bare() : null;
		message.isCommand = commandRegEx.test(message.body);
		message.commandParams = commandRegEx.exec(message.body);

		return message;
	}

	/**
	 * handle error stanzas
	 */
	handleErrorStanza(stanza) {
		logger.warn('Error stanza', stanza.toString());
	}

	/**
	 * Post a message to a target room or user
	 */
	postMessage(to, message) {
		let toJid = to instanceof Xmpp.JID ? to : new Xmpp.JID(to);
		let stanza;

		if (toJid.domain === this.options.mucHost) {
			stanza = new Xmpp.Stanza('message', { to: `${toJid.bare()}/${this.profile.name}`, type: 'groupchat' });
		} else {
			stanza = new Xmpp.Stanza('message', { to: toJid, type: 'chat', from: this.profile.jid });
		}

		stanza
			.c('active', { xmlns : 'http://jabber.org/protocol/chatstates' })
			.up()
			.c('body').t(message);

		this.client.send(stanza);
		logger.info('Sent message', stanza);
		this.emit('sendMessage', stanza);
	}

	/**
	 * Submit IQ stanzas and return a promise
	 */
	sendQuery(stanza) {
		let guid = uuid.v1();
		stanza = stanza.root();
		stanza.attrs.id = stanza.attrs.id || guid;
		let result = new Promise((resolve, reject) => {
			this.once(`id:${guid}`, (response) => {
				resolve(response);

				// TODO error handling
			});
		});

		this.client.send(stanza);

		return result;
	}

	/**
	 * Startup query
	 */
	getStartupData() {
		let stanza = new Xmpp.Stanza('iq', { to: this.options.mucHost, type: 'get' })
			.c('query', { xmlns: 'http://hipchat.com/protocol/startup', send_auto_join_user_presences: true });

		return this.sendQuery(stanza);
	}

	/**
	 * Set your availability and status message
	 */
	setAvailability(availability, status) {
		let stanza = new Xmpp.Stanza('presence', { type: 'available' })
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
		let stanza = new Xmpp.Stanza('iq', { type: 'get' })
			.c('vCard', { xmlns: 'vcard-temp' });

		return this.sendQuery(stanza);
	}

	/**
	 * Requets a full roster
	 */
	requestRoster() {
		let stanza = new Xmpp.Stanza('iq', { type: 'get' })
			.c('query', { xmlns: 'jabber:iq:roster' });

		return this.sendQuery(stanza);
	}

	/**
	 * Request all rooms
	 */
	requestRooms() {
		let stanza = new Xmpp.Stanza('iq', { to: this.options.mucHost, type: 'get' })
			.c('query', { xmlns: 'http://jabber.org/protocol/disco#items' });

		return this.sendQuery(stanza);
	}

	/**
	 * Join room
	 * - `roomJid`: Target room, in the form of `????_????@conf.hipchat.com`
	 * - `historyStanzas`: how many lines of history to get upon joining
	 */
	joinRoom(roomJid, historyStanzas) {
		if (!historyStanzas) { historyStanzas = 0; }

		let stanza = new Xmpp.Stanza('presence', { to: roomJid + '/' + this.profile.name })
			.c('x', { xmlns: 'http://jabber.org/protocol/muc' })
			.c('history', {
				xmlns: 'http://jabber.org/protocol/muc',
				maxstanzas: String(historyStanzas)
			});

		logger.info('Joining room', stanza.toString());
		this.client.send(stanza);
	}


	/**
	 * Leave a room
	 * - `roomJid`: Target room, in the form of `????_????@conf.hipchat.com`
	 */
	partRoom(roomJid) {
		var stanza = new Xmpp.Stanza('presence', { type: 'unavailable', to: roomJid + '/' + this.profile.name });
		stanza.c('x', { xmlns: 'http://jabber.org/protocol/muc' });
		stanza.c('status').t('hc-leave');

		logger.info('Parting room', stanza.toString());
		this.client.send(stanza);
	}

}

module.exports = Hipchat;
