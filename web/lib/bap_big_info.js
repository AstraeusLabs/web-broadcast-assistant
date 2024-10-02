export const parse_big_info = (big_info_buf) => {
        if (!big_info_buf || big_info_buf.length < 18) {
                console.log("BIG Info data array too small");
        }

        const dv = new DataView(big_info_buf.buffer, big_info_buf.byteOffset, big_info_buf.byteLength);

        const result = {};

        result.num_bis = dv.getUint8(0);
        result.sub_evt_count = dv.getUint8(1);
        result.iso_interval = dv.getUint16(2, true);
        result.burst_number = dv.getUint8(4);
        result.offset = dv.getUint8(5);
        result.rep_count = dv.getUint8(6);
        result.max_pdu = dv.getUint16(7, true);
        result.sdu_interval = dv.getUint32(9, true);
        result.max_sdu = dv.getUint16(13, true);
        result.phy = dv.getUint8(15);
        result.framing = dv.getUint8(16);
        result.encryption = dv.getUint8(17) == 1;

        return result;
}
