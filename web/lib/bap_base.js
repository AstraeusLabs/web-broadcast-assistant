const BT_UUID_BASIC_AUDIO = 0x1851;
const ECANCELLED = 125;

const getIntAt = (data, offset, bytes, signed) => {
	if (!(data instanceof Uint8Array)) {
		throw new Error("Input data must be a Uint8Array");
	}

	const width = bytes * 8;

	let item = 0;
	let count = 0;
	while(count < bytes) {
		item += data[count+offset] << (8*count);
		count++;
	}

	if (signed) {
		const neg = item & (1 << (width - 1));
		const tmp = (1 << width);
		const min = -tmp;
		return neg ? min + (item & (tmp - 1)) : item;
	}

	return item;
}

class ModBuf {
        #buf

        constructor(buf) {
                this.#buf = buf.subarray();
        }

        get len() {
                return this.#buf.length;
        }

        get data() {
                return this.#buf.subarray();
        }

        pull_int(bytes, signed) {
                const val = getIntAt(this.#buf, 0, bytes, signed);
                this.#buf = this.#buf.subarray(bytes);
                return val;
        }

        pull_mem(len) {
                const val = this.#buf.subarray(0, len);
                this.#buf = this.#buf.subarray(len);
                return val;
        }
}

const base_pull_pd = (modBuf) => {
        return modBuf.pull_int(3);
}

const base_pull_bis_count = (modBuf) => {
        return modBuf.pull_int(1);
}

const base_pull_codec_id = (modBuf) => {
        return {
                id: modBuf.pull_int(1),
                cid: modBuf.pull_int(2),
                vid: modBuf.pull_int(2)
        }
}

const base_pull_ltv = (modBuf) => {
        const len = modBuf.pull_int(1);

        return {len, data: modBuf.pull_mem(len)};
}

const base_get_base_from_buf = (buf) => {
        const uuid = getIntAt(buf, 0, 2);

        if (uuid === BT_UUID_BASIC_AUDIO) {
                return buf.subarray(2);
        }
}

const base_get_pres_delay = (base) => {

        const modBuf = new ModBuf(base);
        const pd = modBuf.pull_int(3);

        return pd;
}

const base_get_subgroup_count = (base) => {
        const modBuf = new ModBuf(base);

        modBuf.pull_int(3); // PD
        const subgroup_count = modBuf.pull_int(1);

        return subgroup_count;
}

const base_foreach_subgroup = (base, subgroup_cb, user_data) => {
        const modBuf = new ModBuf(base);

        modBuf.pull_int(3); // PD
        const subgroup_count = modBuf.pull_int(1);

        for (let i = 0; i < subgroup_count; i++) {
                const subgroup_buf = modBuf.data;
                if (!subgroup_cb(subgroup_buf, user_data)) {
                        // user stopped parsing...
                        return -ECANCELLED;
                }

                if (subgroup_count > 1) {
                        const bis_count = base_pull_bis_count(modBuf);

                        base_pull_codec_id(modBuf);

                        // Codec config
                        base_pull_ltv(modBuf);

                        // Meta data
                        base_pull_ltv(modBuf);

                        for (let j = 0; j < bis_count; j++) {
                                // Index
                                modBuf.pull_int(1);

                                // Codec config
                                base_pull_ltv(modBuf);
                        }
                }
        }
}

const base_get_subgroup_bis_count = (subgroup_buf) => {
        const modBuf = new ModBuf(subgroup_buf);

        return base_pull_bis_count(modBuf);
}

const base_get_subgroup_codec_id = (subgroup_buf) => {
        const modBuf = new ModBuf(subgroup_buf);

        base_pull_bis_count(modBuf);
        return base_pull_codec_id(modBuf);
}

const base_get_subgroup_codec_data = (subgroup_buf) => {
        const modBuf = new ModBuf(subgroup_buf);

        base_pull_bis_count(modBuf);
        base_pull_codec_id(modBuf);

        // Codec config
        return base_pull_ltv(modBuf);
}

const base_get_subgroup_codec_meta = (subgroup_buf) => {
        const modBuf = new ModBuf(subgroup_buf);

        base_pull_bis_count(modBuf);
        base_pull_codec_id(modBuf);

        // Codec config
        base_pull_ltv(modBuf);

        // Meta data
        return base_pull_ltv(modBuf);
}

const base_subgroup_foreach_bis = (subgroup_buf, bis_cb, user_data) => {
        const modBuf = new ModBuf(subgroup_buf);

        const bis_count = base_pull_bis_count(modBuf);
        base_pull_codec_id(modBuf);

        // Codec config
        base_pull_ltv(modBuf);

        // Meta data
        base_pull_ltv(modBuf);

        for (let i = 0; i < bis_count; i++) {
                const index = modBuf.pull_int(1);
                const ltv = base_pull_ltv(modBuf);

                if (!bis_cb({index, data: ltv.data, data_len: ltv.len}, user_data)) {
                        // user stopped parsing...
                        return -ECANCELLED;
                }
        }
}

// LTV related

export const BT_CodecConf = Object.freeze({
        SamplingFrequency:              0x01,
        FrameDuration:                  0x02,
        AudioChannelAllocation:         0x03,
        OctetsPerCodecFrame:            0x04,
        CodecFrameBlocksPerSDU:         0x05
});

export const BT_Meta = Object.freeze({
        PreferredAudioContexts:         0x01,
        StreamingAudioContexts:         0x02,
        ProgramInfo:                    0x03,
        Language:                       0x04,
        CCIDList:                       0x05,
        ParentalRating:                 0x06,
        ProgramInfoURI:                 0x07,
        ExtendedMetadata:               0xFE,
        VendorSpecific:                 0xFF
});

const SampleRates = [
        -1,
        8000,
        11025,
        16000,
        22050,
        24000,
        32000,
        44100,
        48000,
        88200,
        96000,
        176400,
        192000,
        384000
];

const FrameDurations = [
        7.5,
        10
];

const keyName = (obj, val) => {
	return Object.entries(obj).find(i => i[1] === val)?.[0];
}

const parseCodecConfLTVItem = (type, len, value) => {
	if (len === 0 || len != value.length) {
		return;
	}

        const name = keyName(BT_CodecConf, type);

	const item = { type, name };
	// For now, just parse the ones we know
	switch (type) {
		case BT_CodecConf.SamplingFrequency:
                const freq_id = getIntAt(value, 0, 1);
		item.value = SampleRates[freq_id];
		break;
		case BT_CodecConf.FrameDuration:
                const fd_id = getIntAt(value, 0, 1);
		item.value = FrameDurations[fd_id];
		break;
		case BT_CodecConf.AudioChannelAllocation:
                item.value = getIntAt(value, 0, 4);
		break;
		case BT_CodecConf.OctetsPerCodecFrame:
                item.value = getIntAt(value, 0, 2);
		break;
		case BT_CodecConf.CodecFrameBlocksPerSDU:
                item.value = getIntAt(value, 0, 1);
		break;
		default:
		item.value = "UNHANDLED";
		break;
	}

	return item;
}

const parseMetaLTVItem = (type, len, value) => {
	if (len === 0 || len != value.length) {
		return;
	}

        const name = keyName(BT_Meta, type);

	const item = { type, name };
	// For now, just parse the ones we know
	switch (type) {
                case BT_Meta.PreferredAudioContexts:
		case BT_Meta.StreamingAudioContexts:
                item.value = getIntAt(value, 0, 2);
		break;
                case BT_Meta.ProgramInfo:
		case BT_Meta.Language:
                const decoder = new TextDecoder();
                item.value = decoder.decode(value);
		break;
                case BT_Meta.CCIDList:
                // For now, just grab and store the complete byte array as is
                item.value = Array.from(value);
                break;
		default:
		item.value = "UNHANDLED";
		break;
	}

	return item;
}

export const ltvToTvArray = (payload, ltv_cb) => {
	const res = [];

	if (!payload) {
		return res;
	}

	// console.log('LTV decode of: ', arrayToHex(payload));
	let ptr = 0;
	// Iterate over the LTV fields and convert to items in array.
	while (ptr < payload.length) {
		const len = payload[ptr++] - 1;
		const type = payload[ptr++];
		if (ptr + len > payload.length) {
			console.warn("Error in LTV structure");
			break;
		}
		const value = payload.subarray(ptr, ptr + len);
		ptr += len;

		const item = ltv_cb(type, len, value);
		if (item) {
			res.push(item);
		}
	}

	return res;
}

// app

const print_bis_cb = (bis, user_data) => {
        const bis_data_parsed = ltvToTvArray(bis.data, parseCodecConfLTVItem);

        console.log(`BIS(${bis.index})`, bis_data_parsed);

        return true;
}

const print_subgroup_cb = (subgroup_buf, user_data) => {
        const bis_count = base_get_subgroup_bis_count(subgroup_buf);

        console.log(`Bis Count: ${bis_count}`);

        const codec_id = base_get_subgroup_codec_id(subgroup_buf);

        console.log("Codec ID: ", codec_id);

        const codec_data = base_get_subgroup_codec_data(subgroup_buf);
        const codec_data_parsed = ltvToTvArray(codec_data.data, parseCodecConfLTVItem);

        console.log("Codec data parsed: ", codec_data_parsed);

        const codec_meta = base_get_subgroup_codec_meta(subgroup_buf);
        const codec_meta_parsed = ltvToTvArray(codec_meta.data, parseMetaLTVItem);

        console.log("Codec meta parsed: ", codec_meta_parsed);

        base_subgroup_foreach_bis(subgroup_buf, print_bis_cb)

        return true;
}


export const print_base = (base_buf) => {
        const base = base_get_base_from_buf(base_buf);

        if (!base) {
                console.log("BT_UUID_BASIC_AUDIO not found at start of buffer");
        }

        const pd = base_get_pres_delay(base);

        console.log(`Presentation delay: ${pd}`);

        const subgroup_count = base_get_subgroup_count(base);

        console.log(`Subgroup count: ${subgroup_count}`);

        base_foreach_subgroup(base, print_subgroup_cb);
}


const parse_bis_cb = (bis, bises) => {
        const bis_data_parsed = ltvToTvArray(bis.data, parseCodecConfLTVItem);

        console.log(`BIS(${bis.index})`, bis_data_parsed);

        bises.push({
                index: bis.index,
                codec_data: bis_data_parsed
        });

        return true;
}

const parse_subgroup_cb = (subgroup_buf, subgroups) => {
        const bis_count = base_get_subgroup_bis_count(subgroup_buf);

        console.log(`Bis Count: ${bis_count}`);

        const subgroup = {};

        subgroup.codec_id = base_get_subgroup_codec_id(subgroup_buf);

        const codec_data = base_get_subgroup_codec_data(subgroup_buf);
        subgroup.codec_data = ltvToTvArray(codec_data.data, parseCodecConfLTVItem);

        const codec_meta = base_get_subgroup_codec_meta(subgroup_buf);
        subgroup.codec_meta = ltvToTvArray(codec_meta.data, parseMetaLTVItem);

        subgroup.bises = [];

        base_subgroup_foreach_bis(subgroup_buf, parse_bis_cb, subgroup.bises)

        subgroups.push(subgroup);

        return true;
}

export const parse_base = (base_buf) => {
        const base = base_get_base_from_buf(base_buf);

        if (!base) {
                console.log("BT_UUID_BASIC_AUDIO not found at start of buffer");
        }

        const result = {};

        result.presentation_delay = base_get_pres_delay(base);
        result.subgroup_count = base_get_subgroup_count(base);

        result.subgroups = [];

        base_foreach_subgroup(base, parse_subgroup_cb, result.subgroups);

        return result;
}
