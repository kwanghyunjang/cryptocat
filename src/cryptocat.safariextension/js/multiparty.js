﻿var multiParty = function() {};
(function(){

var publicKeys = {};
var sharedSecrets = {};
var fingerprints = {};
var myPrivateKey;
var myPublicKey;

multiParty.requestRegEx = /^\?:3multiParty:3\?:keyRequest$/;
multiParty.publicKeyRegEx = /^\?:3multiParty:3\?:publicKey:(\w|=)+$/;

// AES-CTR-256 encryption
// No padding, starting IV of 0
// Input: UTF8, Output: Base64
// Key input: hexademical
encryptAES = function(msg, c, iv) {
	var opts = {
		mode: CryptoJS.mode.CTR,
		iv: CryptoJS.enc.Base64.parse(iv),
		padding: CryptoJS.pad.NoPadding
	}
	var aesctr = CryptoJS.AES.encrypt (
		CryptoJS.enc.Utf8.parse(msg),
		CryptoJS.enc.Hex.parse(c),
		opts
	)
	return aesctr.toString();
}

// AES-CTR-256 decryption
// No padding, starting IV of 0
// Input: Base64, Output: UTF8
// Key input: hexadecimal
decryptAES = function(msg, c, iv) {
	msg = CryptoJS.enc.Base64.parse(msg);
	var opts = {
		mode: CryptoJS.mode.CTR,
		iv: CryptoJS.enc.Base64.parse(iv),
		padding: CryptoJS.pad.NoPadding
	}
	var aesctr = CryptoJS.AES.decrypt(
		CryptoJS.enc.Base64.stringify(msg),
		CryptoJS.enc.Hex.parse(c),
		opts
	)
	return aesctr.toString(CryptoJS.enc.Utf8);
}

// HMAC-SHA512
// Output: Base64
// Key input: Hexademical
HMAC = function (msg, key) {
	return CryptoJS.HmacSHA512(
		msg, CryptoJS.enc.Hex.parse(key)
	).toString(CryptoJS.enc.Base64);
}

// Check if received public key is within safe size parameters
checkSize = function(publicKey) {
	var z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4096, 0];
	publicKey = BigInt.str2bigInt(publicKey, 64);
	if ((BigInt.equals(publicKey, Curve25519.p25519)
		|| BigInt.greater(publicKey, Curve25519.p25519)
		|| BigInt.greater(z, publicKey))) {
		console.log('multiParty: unsafe key size');
		return false;
	}
	else {
		return true;
	}
}

// Generate private key (32 byte random number)
// Represented in decimal
multiParty.genPrivateKey = function() {
	myPrivateKey = Cryptocat.randomString(32, 0, 0, 1);
	return myPrivateKey;
}

// Set a previously generated private key (32 byte random number)
// Represented in decimal
multiParty.setPrivateKey = function(privateKey) {
	myPrivateKey = privateKey;
}

// Generate public key (Curve 25519 Diffie-Hellman with basePoint 9)
// Represented in Base64
multiParty.genPublicKey = function() {
	myPublicKey = BigInt.bigInt2str(Curve25519.ecDH(myPrivateKey), 64);
	return myPublicKey;
}

// Generate shared secrets
// First 256 bytes are for encryption, last 256 bytes are for HMAC.
// Represented in hexadecimal
multiParty.genSharedSecret = function(user) {
	sharedSecret = CryptoJS.SHA512(
		Curve25519.ecDH(
			myPrivateKey, BigInt.str2bigInt(
				publicKeys[user], 64
			)
		)
	).toString();
	sharedSecrets[user] = {
		'message': sharedSecret.substring(0, 64),
		'hmac': sharedSecret.substring(64, 128)
	}
	// console.log(sharedSecrets);
}

// Get fingerprint fingerprint
// If user is null, returns own fingerprint
multiParty.genFingerprint = function(user) {
	if (!user) {
		var key = myPublicKey;
	}
	else {
		var key = publicKeys[user];
	}
	return fingerprints[user] = CryptoJS.SHA512(key)
		.toString()
		.substring(0, 40)
		.toUpperCase();
}

// Send public key request string.
multiParty.sendPublicKeyRequest = function(user) {
	var request = {};
	request['text'][user] = {};
	request['text'][user]['message'] = '?:3multiParty:3?:keyRequest';
	return JSON.stringify(request);
}

// Send my public key in response to a public key request.
multiParty.sendPublicKey = function(user) {
	var answer = {};
	answer['text'] = {}
	answer['text'][user] = {};
	answer['text'][user]['message'] = '?:3multiParty:3?:publicKey:' + myPublicKey;
	return JSON.stringify(answer);
}

// Return number of users
multiParty.userCount = function() {
	return Object.keys(sharedSecrets).length;
}

// Generate messasge hash
multiParty.messageHash = function(message) {
	for (var i = 0; i !== 32; i++) {
		message = CryptoJS.SHA512(message);
	}
	return message.toString(CryptoJS.enc.Base64);
}

// Send message.
multiParty.sendMessage = function(message) {
	message += Cryptocat.randomString(64, 1, 1, 1, 0);
	var encrypted = {};
	encrypted['text'] = {};
	encrypted['hash'] = message;
	var concatenatedCiphertext = '';
	var sortedRecipients = Object.keys(sharedSecrets).sort();
	for (var i = 0; i !== sortedRecipients.length; i++) {
		var iv = CryptoJS.enc.Hex.parse(Cryptocat.randomString(24, 0, 0, 0, 1)).toString(CryptoJS.enc.Base64);
		encrypted['text'][sortedRecipients[i]] = {};
		encrypted['text'][sortedRecipients[i]]['message'] = encryptAES(message, sharedSecrets[sortedRecipients[i]]['message'], iv);
		encrypted['text'][sortedRecipients[i]]['iv'] = iv;
		concatenatedCiphertext += encrypted['text'][sortedRecipients[i]]['message'] + encrypted['text'][sortedRecipients[i]]['iv'];
	}
	for (var i = 0; i !== sortedRecipients.length; i++) {
		encrypted['text'][sortedRecipients[i]]['hmac'] = HMAC(concatenatedCiphertext, sharedSecrets[sortedRecipients[i]]['hmac']);
		encrypted['hash'] += encrypted['text'][sortedRecipients[i]]['hmac'];
	}
	encrypted['hash'] = multiParty.messageHash(encrypted['hash']);
	// console.log(encrypted);
	return JSON.stringify(encrypted);
}

// Receive message. Detects requests/reception of public keys.
multiParty.receiveMessage = function(sender, myName, message) {
	try {
		message = JSON.parse(message);
	}
	catch(err) {
		console.log('multiParty: failed to parse message object');
		return false;
	}
	if (typeof(message['text'][myName]) === 'object' &&
		typeof(message['text'][myName]['message']) === 'string') {
		// Detect public key reception, store public key and generate shared secret
		if (message['text'][myName]['message'].match(multiParty.publicKeyRegEx)) {
			if (!publicKeys.hasOwnProperty(sender)) {
				var publicKey = message['text'][myName]['message'].substring(27);
				if (checkSize(publicKey)) {
					publicKeys[sender] = publicKey;
					multiParty.genFingerprint(sender);
					multiParty.genSharedSecret(sender);
				}
			}
			return false;
		}
		// Detect public key request and send public key
		else if (message['text'][myName]['message'].match(multiParty.requestRegEx)) {
			multiParty.sendPublicKey(sender);
		}
		// Decrypt message
		else if (sharedSecrets.hasOwnProperty(sender)) {
			// console.log(message);
			var concatenatedCiphertext = '';
			var sortedRecipients = Object.keys(message['text']).sort();
			for (var i = 0; i !== sortedRecipients.length; i++) {
				concatenatedCiphertext += message['text'][sortedRecipients[i]]['message'] + message['text'][sortedRecipients[i]]['iv'];
			}
			if (message['text'][myName]['hmac'] === HMAC(concatenatedCiphertext, sharedSecrets[sender]['hmac'])) {
				var plaintext = decryptAES(message['text'][myName]['message'], sharedSecrets[sender]['message'], message['text'][myName]['iv']);
				var messageHash = plaintext;
				for (var i = 0; i !== sortedRecipients.length; i++) {
					messageHash += message['text'][sortedRecipients[i]]['hmac'];
				}
				if (multiParty.messageHash(messageHash) === message['hash']) {
					return plaintext.substring(0, plaintext.length - 64);
				}
				else {
					console.log('multiParty: message hash failure');
					return false;
				}
			}
			else {
				console.log('multiParty: HMAC failure');
				return false;
			}
		}
	}
	return false;
}

// Rename keys (useful in case of nickname change)
multiParty.renameKeys = function(oldName, newName) {
	publicKeys[newName] = publicKeys[oldName];
	sharedSecrets[newName] = sharedSecrets[oldName];
	multiParty.genFingerprint(newName);
	multiParty.removeKeys(oldName);
}

// Remove user keys and information
multiParty.removeKeys = function(user) {
	delete publicKeys[user];
	delete sharedSecrets[user];
	delete fingerprints[user];
}

// Remove ALL user keys and information
multiParty.resetKeys = function() {
	publicKeys = {};
	sharedSecrets = {};
	fingerprints = {};
}

})();//:3