# Web Broadcast Assistant

If you haven't done it yet, first go to [The Zephyr getting started guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html) and install all dependencies (I'd recommend following the path with the virtual python environment).

# For development
For developers of the application, first do a fork of the repo.  Then do the following:

Make a local workspace folder (to hold the repo, zephyr and west modules):

```
mkdir my-workspace
cd my-workspace
```

Clone the repo:

```
git clone git@github.com:<your handle>/web-broadcast-assistant.git
```

Initialize west and update dependencies:

```
west init -l web-broadcast-assistant
west update
```

# For normal use (non-development)
This repo contains a stand alone Zephyr application that can be fetched and initialized like this:

```
west init -m https://github.com/astraeuslabs/web-broadcast-assistant --mr main my-workspace
```

Then use west to fetch dependencies:

```
cd my-workspace
west update
```

# Build and flash

Go to the repo folder:

```
cd web-broadcast-assistant
```

## Build

### nRF5340 Audio DK board
The nRF5340 Audio DK has two cores - one for the application and one dedicated for the network (bluetooth controller).
The bluetooth controller can be builded from zephyr/samples/bluetooth/hci_ipc:
```
west build -b nrf5340_audio_dk_nrf5340_cpunet -d build/hci_ipc ../zephyr/samples/bluetooth/hci_ipc --pristine -- -DCONF_FILE=nrf5340_cpunet_iso-bt_ll_sw_split.conf
```
### Application
```
west build -b <target board id> -d build/app app --pristine
```

## Flash

### nRF5340 Audio DK board
Clear all mem for the two cores with the recover command:
```
nrfjprog --recover --coprocessor CP_NETWORK
nrfjprog --recover
```
And flash with the west command:
```
west flash -d build/hci_ipc
```
### Application
```
west flash -d build/app
```
