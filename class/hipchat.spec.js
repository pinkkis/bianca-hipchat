/* globals before, should, done, expect */
'use strict';

const Hipchat = require('./hipchat');

describe('Class Hipchat', () => {

	beforeEach(() => {
		// nothing
	});

	describe('when creating a new bot', () => {

		it('should take in options', () => {
			let hipchat = new Hipchat({foo: 1, bar: 2});
			expect(hipchat.options).to.exist;
		});

		it('Should require params');
		it('Should connect with #connect');

	});

});
