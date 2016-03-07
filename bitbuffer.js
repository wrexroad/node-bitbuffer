"use strict"

function BitBuffer() {
	var construct =
		(typeof arguments[0] == "string") ? BitBuffer.fromString :
		(arguments[0] && arguments[0].length) ? BitBuffer.fromBitArray :
		BitBuffer.fromSize
	
	var buff = construct.call(null, arguments[0], arguments[1])
	this.length = buff.length
	this.buffer = buff.buffer
	this.startBit = 0
}

//reading values requires us to know which order the
//internal Buffer's bytes are stored
BitBuffer.hostEndianness = require("os").endianness()

BitBuffer.fromSize = function(bitSize, buffer) {
	bitSize = +bitSize || 0 //make sure this is a number
	var
		byteSize = Math.ceil(bitSize / 8),
		buff = {}
	
	//if a Buffer is supplied, use it, other wise initialise a new one
	if (buffer != undefined) {
		buff.buffer = buffer
	} else {
		buff.buffer = new Buffer(byteSize)
		buff.buffer.fill(0)
	}
	
	//since the internal Buffer is made of complete bytes, we need to track
	//how many bits are in the BitBuffer separately
	buff.length = bitSize
	
	return buff
}

BitBuffer.fromBitArray = function(bitarr) {
	var
		bitSize = bitarr.length,
		buff = new BitBuffer(bitSize)
	
	bitarr.forEach(function(bit, bit_i){
		buff.set(bit_i, bit)
	})
	
	return buff
}

BitBuffer.fromString = function(str, enc) {
	//default to binary if no encoding is specified
	enc = (enc || "binary").toLowerCase()
	return BitBuffer.transcoders[enc].fromString(str) 
}

BitBuffer.fromBinaryString = function(bitstr) {
	var
		bitSize = bitstr.length,
		bit_i = 0,
		buff = new BitBuffer(bitSize);
	
	if (bitSize < 1) {
		return buff
	}

	//treat the string as an array of bits that has been indexed backwards
	//(bit 0 on the left)
	while (bitSize--) {
		buff.set(bit_i++, !!+bitstr[bitSize])
	}
	
	return buff
}

BitBuffer.fromHexString = function(hexstr) {
	var
		nybbleSize = hexstr.length,
		bitSize = nybbleSize << 2,
		buff = new BitBuffer(bitSize),
		byteVal;
	
	if (nybbleSize < 1) {
		return new BitBuffer(0)
	}

	//pad the hex string if it contains an odd number of nybbles
	if (nybbleSize % 2 != 0) {
		hexstr = "0" + hexstr
		nybbleSize++
		bitSize += 4
	}
	
	//nybble 0 is on the left
	for (var bit_i=bitSize-1, nyb_i=0; nyb_i < nybbleSize; bit_i-=8, nyb_i+=2) {
		byteVal = +("0x" + hexstr[nyb_i] + hexstr[nyb_i+1])
		if (!isFinite(byteVal)) {
			throw RangeError(
				hexstr[nyb_i] + hexstr[nyb_i+1] + " is not a valid hex value."
			)
		}
		buff.buffer[bit_i >>> 3] = +(byteVal)
	}
	
	return buff
}

//reference all of the to/from string functions
BitBuffer.transcoders = {
	hex : {
		fromString : function (str) {
			return BitBuffer.fromHexString(str)
		},
		toString : function(buff) {
			return buff ? buff.toHexString() : ""
		}
	},
	binary : {
		fromString : function (str) {
			return BitBuffer.fromBinaryString(str)
		},
		toString : function(buff) {
			return buff ? buff.toBinaryString() : ""
		}
	}
}

BitBuffer.isEncoding = function(enc) {
	return !!BitBuffer.transcoders[(enc + "").toLowerCase()];
}

BitBuffer.prototype = {
	set: function(index, bool) {
		index += this.startBit
		var pos = index >>> 3
		if(bool) {
			this.buffer[pos] |= 1 << (index % 8)
		} else {
			this.buffer[pos] &= ~(1 << (index % 8))
		}
	},
	get: function(index) {
		index += this.startBit
		return (this.buffer[index >>> 3] & (1 << (index % 8))) != 0
	},
	toggle: function(index) {
		index += this.startBit
		this.buffer[index >>> 3] ^= 1 << (index % 8)
	},
	toBuffer: function() {
		return this.buffer
	},
	
	subbuffer: function(begin, end) {
		var newbuff, size 
		
		//make sure begin and end are valid
		begin = +begin || this.startBit
		end = isFinite(+end) ? end : this.startBit + this.length
		
		//negative values are read from the end of the buffer
		begin = begin >= 0 ? begin : this.length + begin
		end = end >= 0 ? end : this.length + end
		
		//end should come after the begining
		size = end - begin
		if (size < 1) {
			return new BitBuffer(0)
		}
		
		newbuff = new BitBuffer(size)
		
		this.copy(newbuff, 0, begin, end)
		
		return newbuff
	},
	
	copy: function(destBuff, destStart, srcStart, srcEnd) {
		destStart = +destStart || 0
		srcStart = +srcStart || this.startBit
		srcEnd = isFinite(+srcEnd) ? srcEnd : this.startBit + this.length
		var length = srcEnd - srcStart
		
		if (srcEnd > this.length) {
			throw new RangeError("Can not read source BitBuffer beyond end.")
		} else if (destStart + length > destBuff.size) {
			throw new RangeError("Can not write destination BitBuffer beyond end.")
		}
		
		for (var bit_i = 0; bit_i < length; bit_i++) {
			destBuff.set(destStart + bit_i, this.get(srcStart + bit_i))
		}
		
		return length
	},
	
	/*shiftRight: function(shiftBits) {
		var shiftBytes, buf, maxBit, startByte, endByte
		
		if (shiftBits < 0) {
			return this.shiftLeft(-shiftBits)
		}
		shiftBytes = shiftBits / 8 >> 0
		
		//shift right by adjusting the startBit property left 
		this.startBit += shiftBits
		
		//figure out how many bits were "shifted" in
		maxBit = this.startBit + this.length
		
		//mask off the bits we shifted out on the low side
		this.buffer[shiftBytes] &= ~(Math.pow(2, (shiftBits % 8)) - 1)
		
		//Check if the shifting pushed us over the end of the Buffer
		if (maxBit > this.buffer.length << 3) {
			startByte = (this.startBit / 8) >> 0
			endByte = Math.ceil(maxBit / 8)
			buf = new Buffer(endByte - startByte)
			buf.fill(0)
			
			this.buffer.copy(buf, 0, startByte, this.buffer.length)
			this.buffer = buf
			this.startBit %= 8
		}
		
		return this
	},*/
	shiftRight: function(shiftBits) {
		var buf, startByte, endByte, maskByte
		
		if (shiftBits < 0) {
			return this.shiftLeft(-shiftBits)
		}
		
		//figure out which byte the lowest bit is currently in
		maskByte = (this.startBit / 8) >> 0
		
		
		//shift the BitBuffer right by adjusting the startBit property left 
		this.startBit += shiftBits
		
		//mask the bits that were just shifted out
		this.buffer[maskByte] =
			this.buffer[maskByte] & ~(Math.pow(2, (this.startBit) % 8) - 1)		
		
		//if the start bit has been pushed past the end of the BitBuffer,
		//add a byte
		endByte = Math.ceil((this.length + this.startBit) / 8)
		startByte = ((this.startBit / 8) >> 0)
		if (endByte > this.buffer.length) {
			buf = new Buffer(endByte - startByte)
			buf.fill(0)
			this.buffer.copy(buf, 0, startByte, this.buffer.length)
			this.buffer = buf
			this.startBit -= (8 * startByte)
		}
		
		return this
	},
	shiftLeft: function(shiftBits) {
		var newBytes, buf, maxBit, endByte, maskByte
		
		if (shiftBits < 0) {
			return this.shiftRight(-shiftBits)
		}
		
		//figure out which byte the highest bit is currently in
		maxBit = this.startBit + this.length
		maskByte = (maxBit) / 8 >> 0
		
		//mask the bits that are going to be shifted out
		this.buffer[maskByte] =
			this.buffer[maskByte] & (Math.pow(2, ((maxBit - shiftBits) % 8)) - 1)
		
		//shift the BitBuffer left by adjusting the startBit property right 
		this.startBit -= shiftBits
		
		//if the start bit has been pushed before the begining of the BitBuffer,
		//add a byte
		if (this.startBit < 0) {
			endByte = Math.ceil((this.length + this.startBit) / 8)
			newBytes = Math.ceil(-this.startBit / 8)
			buf = new Buffer(endByte + newBytes)
			buf.fill(0)
			this.buffer.copy(buf, newBytes, 0, this.buffer.length)
			this.buffer = buf
			this.startBit += (8 * newBytes)
		}
		
		return this
	},
	
	toBitArray: function(bitOrder) {
		var bitarr = [], bit_i
		if (bitOrder < 0) {
			//bitOrder can be set to a negative number to reverse the bit array
			for (bit_i = 0; bit_i < this.length; bit_i++) {
				bitarr.unshift(+!!this.get(bit_i))
			}
		} else {
			for (bit_i = 0; bit_i < this.length; bit_i++) {
				bitarr.push(+!!this.get(bit_i))
			}
		}
		return bitarr
	},
	
	toString: function(enc) {
		//default to binary if no encoding is specified
	  enc = (enc || "binary").toLowerCase()
	  return BitBuffer.transcoders[enc].toString(this)
	},
	toBinaryString: function() {
		return this.toBitArray(-1).join("")
	},
	toHexString: function() {
		var
			bits = this.toBitArray(),
			hexarr = [],
			byteVal, bit_i;
		
		for (bit_i = 0; bit_i < bits.length; bit_i += 4) {
			byteVal = 0
			byteVal |= +!!bits[bit_i]
			byteVal |= +!!bits[bit_i + 1] << 1
			byteVal |= +!!bits[bit_i + 2] << 2
			byteVal |= +!!bits[bit_i + 3] << 3
			hexarr.unshift(byteVal.toString(16))
		}
		
		return hexarr.join("")
	},
	
	readUInt8: function(offset, width){
		return this.read("uint", 8, null, offset, width)
	},
	readUInt16BE: function(offset, width){
		return this.read("uint", 16, "BE", offset, width)
	},
	readUInt16LE: function(offset, width){
		return this.read("uint", 16, "LE", offset, width)
	},
	readUInt32BE: function(offset, width){
		return this.read("uint", 32, "BE", offset, width)
	},
	readUInt32LE: function(offset, width){
		return this.read("uint", 32, "LE", offset, width)
	},
	readInt8: function(offset, width){
		return this.read("int", 8, null, offset, width)
	},
	readInt16BE: function(offset, width){
		return this.read("int", 16, "BE", offset, width)
	},
	readInt16LE: function(offset, width){
		return this.read("int", 16, "LE", offset, width)
	},
	readInt32BE: function(offset, width){
		return this.read("int", 32, "BE", offset, width)
	},
	readInt32LE: function(offset, width){
		return this.read("int", 32, "LE", offset, width)
	},
	readFloatBE: function(offset){
		return this.read("float", 32, "BE", offset)
	},
	readFloatLE: function(offset){
		return this.read("float", 32, "LE", offset)
	},
	readDoubleBE: function(offset){
		return this.read("double", 64, "BE", offset)
	},
	readDoubleLE: function(offset){
		return this.read("double", 64, "LE", offset)
	},
	read: function(type, typeWidth, endianness, offset, readWidth) {
		var buff
		
		//validate that input and fill in any blanks we can
		type = (type + "").toLowerCase()
		if (type == "float") {
			typeWidth = 32
		} else if (type == "double") {
			typeWidth = 64
		}
		if (typeWidth == 8) {
			endianness = "BE"
		}
		if (!typeWidth || !endianness) {
			//dont really know what to do here...
			return null
		}
		
		
		/*
			If this is running on a little endian system, the underlying Buffer has
			been written "backwards" byte indicies.
			That is to say you did this: 
				`(new Buffer(2)).write("0001", hex)`
			you would end up with two bytes of memory that look like this:
				`[00][01]`
			However, because of the way BitBuffer fills memory it uses the host to
			decide where each bit is stored. So if you did this on an LE system:
				`(new BitBuffer(16)).set(0,1)`
			the underlying Buffer would have two bytes of memory that look like this:
				[01][00]
			
			So, if you wanted to read out a BE number from memory on a LE system you
			would actually have to read it as a LE number.
			
			Long story short: if this is an LE system, we need to use the opposite 
			reader than what was requested.
		*/
		if (BitBuffer.hostEndianness == "LE") {
			endianness = endianness == "LE" ? "BE" : "LE"
		}
		
		readWidth =
			!(+readWidth > 0) ? typeWidth :
				readWidth < typeWidth ? readWidth : typeWidth
		offset = (+offset || 0) + this.startBit
		
		//create new buffer that matches the width we are going to read as a number
		buff = new BitBuffer(typeWidth)
		
		//when reading less than the full typeWidth of bits,
		//we need to sign extend the ints
		if (
			readWidth < typeWidth && type == "int" && this.get(offset + readWidth)
		) {
			buff.buffer.fill(0xff)
		}
		
		//copy all the bits to the new buffer so bit 0 is aligned with byte 0
		this.copy(buff, 0, offset, offset + readWidth)
		
		return (
			((this._byteReaders[type] || {})[typeWidth] || {})[endianness] ||
			function(){return null}
		).call(buff.buffer, 0);
	},
	_byteReaders: {
		"uint": {
			8: {
				"LE": Buffer.prototype.readUInt8,
				"BE": Buffer.prototype.readUInt8
			},
			16: {
				"LE": Buffer.prototype.readUInt16LE,
				"BE": Buffer.prototype.readUInt16BE
			},
			32: {
				"LE": Buffer.prototype.readUInt32LE,
				"BE": Buffer.prototype.readUInt32BE
			}
		},
		"int": {
			8: {
				"LE": Buffer.prototype.readInt8,
				"BE": Buffer.prototype.readInt8
			},
			16: {
				"LE": Buffer.prototype.readInt16LE,
				"BE": Buffer.prototype.readInt16BE
			},
			32: {
				"LE": Buffer.prototype.readInt32LE,
				"BE": Buffer.prototype.readInt32BE
			}
		},
		"float": {
			32: {
				"LE": Buffer.prototype.readFloatLE,
				"BE": Buffer.prototype.readFloatBE
			}
		},
		"double": {
			64: {
				"LE": Buffer.prototype.readDoubleLE,
				"BE": Buffer.prototype.readDoubleBE
			}
		}
	}
}

exports.BitBuffer = BitBuffer
