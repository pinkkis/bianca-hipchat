'use strict';

const EventEmitter = require('events');
const Xmpp = require('node-xmpp-client');
const uuid = require('uuid');

class Hipchat extends EventEmitter {
	constructor(options) {
		super();

		this.options = options || {};

		this.useLogger(options.logger);

		this.keepAliveTime = this.options.keepAliveTime || 60000;
		this.rooms = [];
		this.roster = [];
		this.presences = [];
		this.profile = null;
		this.serverData = null;

		this.emit('created');
	}

	/**
	 * Override logger with a different implementation, like Winston
	 */
	useLogger(logger) {
		if (logger && logger.log && logger.debug && logger.info && logger.error && logger.warn) {
			this.logger = logger;
		} else {
			this.logger = global.console;
			this.logger.debug = global.console.log;
			this.logger.silly = global.console.log;
		}
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
		this.logger.warn(`Client disconnected: ${error}, ${this.client.connection.reconnect}`);
	}

	/**
	 * Reconnecting event handler
	 */
	onReconnect() {
		this.emit('reconnecting');
		this.logger.info('Client reconnecting');
	}

	/**
	 * Offline handler
	 */
	onOffline() {
		this.emit('offline');
		this.logger.info('Client offline');
	}

	onStanza(stanza) {
		this.logger.silly('stanza', stanza);

		if (stanza.attrs.type === 'error') {
			return this.handleErrorStanza(stanza);
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
		this.logger.error('onError', e);
	}

	/**
	 * Online event handler
	 * called every time the client connects
	 */
	onOnline() {
		this.logger.info('Client connected');

		this.setAvailability('chat', `Available`);

		this.emit('connected');

		let startupData = this.requestStartup().then(resp => this.onStartupDataResult(resp));
		let rooms = this.requestRooms().then(resp => this.onRoomsResult(resp));
		let roster = this.requestRoster().then(resp => this.onRosterResult(resp));

		this.startKeepAlive();
	}

	/**
	 * Handle Profile responses
	 * Todo: startup already handles this, and the format is different in vCard here
	 */
	onProfileResult(stanza) {
		this.logger.info('Profile response', stanza.toString());
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
		this.logger.info(`Rooms updated with ${this.rooms.length} rooms.`);
		this.logger.silly('Rooms stanza', stanza.toString());
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
		this.logger.info(`Roster updated with ${this.roster.length} users.`);
		this.logger.silly('Roster stanza', stanza.toString());
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
		this.profile.user_id = data.user_id = parseInt(query.getChildText('user_id'));
		this.profile.email = data.email = query.getChildText('email');
		this.profile.mention_name = data.mention_name = query.getChildText('mention_name');
		this.profile.name = data.name = query.getChildText('name');
		this.profile.photo_large = data.photo_large = query.getChildText('photo_large');
		this.profile.photo_small = data.photo_small = query.getChildText('photo_small');
		this.profile.title = data.title = query.getChildText('title');
		this.profile.is_admin = data.is_admin = query.getChildText('is_admin');

		data.group_id = parseInt(query.getChildText('group_id'));
		data.group_name = query.getChildText('group_name');
		data.group_uri_domain = query.getChildText('group_uri_domain');
		data.group_invite_url = query.getChildText('group_invite_url');
		data.group_avatar_url = query.getChildText('group_avatar_url');
		data.group_absolute_avatar_url = query.getChildText('group_absolute_avatar_url');

		data.token = query.getChildText('token');
		data.addlive_app_id = query.getChildText('addlive_app_id');
		data.plan = query.getChildText('plan');

		data.autojoin = [];
		preferences
			.getChild('autoJoin')
			.getChildren('item')
			.map((room, i, a) => {
				let x = room.getChild('x', 'http://hipchat.com/protocol/muc#room');

				// list includes rooms and 1-1 convos,
				// so only look into rooms under x
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
		this.logger.info('Received Startup data, including user profile.', this.serverData);
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

		// TODO: what if it doesn't have an id?
		this.logger.debug('IQ', stanza);
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
						return p.user.local;
					}).indexOf(presence.user.local);

		if (idx < 0) {
			this.presences.push(presence);
		} else {
			this.presences[idx] = presence;
		}

		this.logger.debug(`Presence updated for ${presence.user.toString()}`);
		this.emit('presenceUpdate', presence);
	}

	/**
	 * Handle message type stanzas
	 */
	handleMessageStanza(stanza) {
		let message = this.parseMessageStanza(stanza);

		this.logger.info('Received message', message);

		if (message.invite) {
			this.emit('invite', message);
		}

		if (message.isCommand) {
			this.emit('botCommand', message);
		}

		if (message.type === 'chat') {
			this.emit('privateMessage', message);
		}

		if (message.type === 'groupchat' && !message.isChannelMessage) {
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

	/**
	 * handle error stanzas
	 */
	handleErrorStanza(stanza) {
		this.logger.warn('Error stanza', stanza.toString());
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
		this.logger.info('Sent message', stanza);
		this.emit('sendMessage', stanza);
	}

	/**
	 * Submit IQ stanzas for queries and return a promise
	 * TODO: nothing rejects these on error
	 */
	sendQuery(stanza) {
		let guid = uuid.v4();
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
	requestStartup() {
		let stanza = new Xmpp.Stanza('iq', { to: this.options.mucHost, type: 'get' })
			.c('query', { xmlns: 'http://hipchat.com/protocol/startup', send_auto_join_user_presences: true });

		this.logger.info('getStartupData', stanza.toString());
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

		this.logger.info('setAvailability', stanza.toString());
		this.client.send(stanza);
	}

	/**
	 * Requets your profile info
	 */
	requestProfile() {
		// vcard query
		let stanza = new Xmpp.Stanza('iq', { type: 'get' })
			.c('vCard', { xmlns: 'vcard-temp' });

		this.logger.info('requestProfile', stanza.toString());
		return this.sendQuery(stanza);
	}

	/**
	 * Requets a full roster
	 */
	requestRoster() {
		let stanza = new Xmpp.Stanza('iq', { type: 'get' })
			.c('query', { xmlns: 'jabber:iq:roster' });

		this.logger.info('requestRoster', stanza.toString());
		return this.sendQuery(stanza);
	}

	/**
	 * Request all rooms
	 */
	requestRooms() {
		let stanza = new Xmpp.Stanza('iq', { to: this.options.mucHost, type: 'get' })
			.c('query', { xmlns: 'http://jabber.org/protocol/disco#items' });

		this.logger.info('requestRooms', stanza.toString());
		return this.sendQuery(stanza);
	}

	/**
	 * Join room
	 * - roomJid: Target room, in the form of xxx_xxx@conf.hipchat.com
	 * - historyStanzas: how many lines of history to get upon joining
	 */
	joinRoom(roomJid, historyStanzas) {
		if (!historyStanzas) { historyStanzas = 0; }

		let stanza = new Xmpp.Stanza('presence', { to: roomJid + '/' + this.profile.name })
			.c('x', { xmlns: 'http://jabber.org/protocol/muc' })
			.c('history', {
				xmlns: 'http://jabber.org/protocol/muc',
				maxstanzas: String(historyStanzas)
			});

		this.logger.info('Joining room', stanza.toString());
		this.client.send(stanza);
	}

	/**
	 * Leave a room
	 * - roomJid: Target room, in the form of xxx_xxx@conf.hipchat.com
	 */
	partRoom(roomJid) {
		var stanza = new Xmpp.Stanza('presence', { type: 'unavailable', to: roomJid + '/' + this.profile.name });
		stanza.c('x', { xmlns: 'http://jabber.org/protocol/muc' });
		stanza.c('status').t('hc-leave');

		this.logger.info('Parting room', stanza.toString());
		this.client.send(stanza);
	}

	/**
	 * Starts the keepalive messages
	 */
	startKeepAlive() {
		this.keepAlive = setInterval(() => {
			if (this.client.connection.connected) {
				this.logger.debug('Keepalive ping');
				this.client.send((' '));
			} else {
				clearInterval(this.keepAlive);
			}

		}, this.keepAliveTime);
	}

	/**
	 * clears and stops a running keepalive
	 */
	stopKeepAlive() {
		if (this.keepAlive) {
			clearInterval(this.keepAlive);
			this.keepAlive = undefined;
		}
	}

	/**
	 * Parses a message type stanza and returns a message with properties
	 */
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

		// TODO: this should be reworked a bit so it's more uniform with other props
		message.invite = null;

		// get further details from X attrs
		let x = stanza.getChild('x', 'http://jabber.org/protocol/muc#user');
		if (x) {
			// check if invite
			let invite = x.getChild('invite');
			if (invite) {
				message.invite = {
					reason: invite.getChildText('reason'),
					room: new Xmpp.JID(stanza.attrs.from),
					from: new Xmpp.JID(invite.attrs.from)
				};
			}

			// TODO are there other x elements?
		}

		return message;
	}

}

module.exports = Hipchat;
