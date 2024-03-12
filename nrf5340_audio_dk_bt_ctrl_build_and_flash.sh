#! /bin/bash
echo 'Clear all mem for the two cores of nRF5340 Audio DK board...'
nrfjprog --recover --coprocessor CP_NETWORK
nrfjprog --recover
echo 'Build Bluetooth Controller...'
west build -b nrf5340_audio_dk_nrf5340_cpunet -d build/hci_ipc ../zephyr/samples/bluetooth/hci_ipc --pristine -- -DCONF_FILE=nrf5340_cpunet_iso-bt_ll_sw_split.conf
echo 'Flash...'
west flash -d build/hci_ipc
