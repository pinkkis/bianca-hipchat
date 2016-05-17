'use strict';

const argv = require('yargs')
	.usage('Usage: $0 --jid <username> --password <password>')
	.option('username', {
		alias: 'u',
		describe: 'Username for connecting to the chat network',
		demand: true
	})
	.option('password', {
		alias: 'p',
		describe: 'Password for connecting to the chat network',
		demand: true
	})
	.help()
	.wrap(70)
	.argv;
const Hipchat = require('../class/hipchat');

let options = {
	jid: argv.username,
	password: argv.password,
	host: 'chat.hipchat.com',
	mucHost: 'conf.hipchat.com',
	reconnect: true,
	keepAliveTime: 60000
};

let hipchat = new Hipchat(options);

hipchat.connect();

process.on('SIGTERM', () => {
	process.exit(0);
});