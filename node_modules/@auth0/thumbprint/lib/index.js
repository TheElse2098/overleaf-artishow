"use strict";

const crypto = require('crypto');

module.exports.calculate = function (cert) {
	const shasum = crypto.createHash('sha1');
	shasum.update(new Buffer(cert, 'base64'));
	return shasum.digest('hex');
};
