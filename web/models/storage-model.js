/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */


export class StorageModel extends EventTarget {
        #assistantModel

        constructor(assistantModel) {
                super();

                if (!assistantModel) {
                        throw Error("Please provide AssistantModel instance.");
                }

                this.#assistantModel = assistantModel;

                this.clear = this.clear.bind(this);
                this.download = this.download.bind(this);

                this.#initialize();

                this.broadcastSourceUpdated = this.broadcastSourceUpdated.bind(this);
        }

        #initialize() {
                // Setup listener

                this.#assistantModel.addEventListener('base-updated', this.broadcastSourceUpdated);
                this.#assistantModel.addEventListener('big-info-updated', this.broadcastSourceUpdated);
        }

        #getKeys(prefix) {
                const res = [];

                for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key.startsWith(prefix)) {
                                res.push(key);
                        }
                }

                return res;
        }

        broadcastSourceUpdated(evt) {
                const { source } = evt.detail;

                if (source?.base && source?.big_info) {
                        // BASE and BIG info present => save full source info in localStorage
                        // using millisec timestamp as key.

                        localStorage.setItem(`source:${Date.now()}`, JSON.stringify(source));
                }

        }

        clear(prefix) {
                if (!prefix) {
                        localStorage.clear();
                        return;
                }

                const keys = this.#getKeys(prefix);

                for (let key of keys) {
                        localStorage.removeItem(key);
                }

        }

        download(prefix) {
                let result = null;
                if (!prefix) {
                        result = {...localStorage};
                } else {
                        const keys = this.#getKeys(prefix);

                        if (keys.length) {
                                result = {};

                                for (let key of keys) {
                                        result[key] = JSON.parse(localStorage.getItem(key));
                                }
                        }
                }

                if (!result) {
                        return;
                }

                // create blob from content
                const blob = new Blob([JSON.stringify(result, null, 2)]);
                const filename = `sources_${new Date().toISOString()}.txt`;

                // Begin 'download' (use Web Share API, if available)
                const files = [new File([blob], filename, {type: 'text/plain'})];
                if(navigator.canShare && navigator.canShare({ files })) {
                        navigator.share({ files });
                } else {
                        const a = document.createElement("a");
                        const url = URL.createObjectURL(blob);
                        a.href = url;
                        a.download = filename;
                        a.click();
                        URL.revokeObjectURL(url);
                }
        }
}
