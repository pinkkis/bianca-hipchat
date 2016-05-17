# Bianca-hipchat
A hipchat connector for the Bianca bot that works standalone. Written as a ES6 class.

Inspired by Wobot (https://github.com/cjoudrey/wobot)

## Usage

```javascript
const Hipchat = require('bianca-hipchat');

let options = {
	jid: '<your hipchat jid>',
	password: '<password>',
	host: '<chat domain>', // chat.hipchat.com
	mucHost: '<chatroom host domain>', // conf.hipchat.com
	reconnect: '<true|false>', // *optional
	keepAliveTime: '<milliseconds>', // *optional
	logger: '<your own logging function>' // or pass the winston logger object *optional
};

let hipchat = new Hipchat(options);

hipchat.connect();
```

---
More docs to come