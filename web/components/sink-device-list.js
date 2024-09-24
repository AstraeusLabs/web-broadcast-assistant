/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as AssistantModel from '../models/assistant-model.js';

import { SinkItem } from './sink-item.js';

/*
* Sink Device List Component
*/

const template = document.createElement('template');
template.innerHTML = `
<style>
#container {
	display: flex;
	flex-direction: column;
	color: #333333;
}

#list:has(sink-item) {
	display: flex;
	flex-direction: column;
	border-radius: 5px;
	box-shadow: 1px 6px 8px lightgray;
}

sink-item:not(:last-child) {
	border-bottom: 1px solid gray;
}

input {
	font-size: 1.2em;
	margin-bottom: 10px;
}

.hidden {
	display: none;
}
</style>
<div id="container">
<h3>Connect to device(s)</h3>
<input id="filter" placeholder="Filter...">
<div id="list">
</div>
</div>
`;

export class SinkDeviceList extends HTMLElement {
	#list
	#model
	#filterTokens

	constructor() {
		super();

		this.#filterTokens = [];
		this.setFilter = this.setFilter.bind(this);
		this.applyFilter = this.applyFilter.bind(this);

		this.sinkFound = this.sinkFound.bind(this);
		this.sinkUpdated = this.sinkUpdated.bind(this);
		this.sinkDisconnected = this.sinkDisconnected.bind(this);
		this.sinkClicked = this.sinkClicked.bind(this);

		const shadowRoot = this.attachShadow({mode: 'open'});
	}

	connectedCallback() {
		console.log("connectedCallback - SinkDeviceList");

		this.shadowRoot?.appendChild(template.content.cloneNode(true));
		// Add listeners, etc.
		this.#list = this.shadowRoot?.querySelector('#list');
		this.shadowRoot?.querySelector('#filter')?.addEventListener('input', evt => { this.setFilter(evt?.target.value) } );

		this.#model = AssistantModel.getInstance();

		this.#model.addEventListener('sink-found', this.sinkFound)
		this.#model.addEventListener('sink-updated', this.sinkUpdated)
		this.#model.addEventListener('sink-disconnected', this.sinkDisconnected)
		this.#model.addEventListener('reset', () => { this.#list.replaceChildren()})
	}

	disconnectedCallback() {
		// Remove listeners, etc.
	}

	sinkClicked(evt) {
		const sinkEl = evt.target;
		// When sink is not connected, request for the sink to be connected
		// and mark the sink with connection pending.
		// Successful connection will result in an event from the attached
		// broadcast assistant device.

		// Likewise, if the sink is connected, a disconnect request is sent,
		// item is marked disconnection pending, etc.

		const sink = sinkEl.getModel();

		console.log('Sink clicked:', sink);

		if (sink.state === "connected") {
			this.#model.disconnectSink(sink);
		} else  {
			this.#model.connectSink(sink);
		}
	}

	setFilter(str) {
		if (!str) {
			this.#filterTokens = [];
		} else {
			const filterLower = str.toLowerCase().trim();
			this.#filterTokens = filterLower.split(' ').filter(i => i);  // Split and remove empty strings
		}

		this.applyFilter();
	}

	applyFilter() {
		const elements = Array.from(this.#list.querySelectorAll('sink-item'));

		if (this.#filterTokens.length === 0) {
			// Remove 'hidden' class from all items
			elements.forEach( i => { i.classList.remove('hidden') } );
			return;
		}

		let found = elements;

		for (const t of this.#filterTokens) {
			found = found.filter(i => i.getModel().addr?.value.addrStr.toLowerCase().includes(t) ||
				i.getModel().name?.toLowerCase().includes(t));
		}

		elements.forEach( i => {
			if (found.includes(i)) {
				i.classList.remove('hidden');
			} else {
				i.classList.add('hidden');
			}
		});
	}

	// TODO: This is not called for now but can be used if we want to sort by RSSI
	orderByRssi() {
		const elements = this.#list.querySelectorAll('sink-item');

		let order = 0;
		[...elements]
			.sort((a, b) => b.getModel().rssi - a.getModel().rssi)
			.forEach(node => { node.style.order=order++ });
	}

	sinkFound(evt) {
		// Assume that the AssistantModel has eliminated duplicates
		// If the addr is random and RPA changed, device will appear
		// As duplicate and the old entry will stay (stale)
		// TODO: Possibly remove stale entries - however, this should
		// not be a big issue.
		const { sink } = evt.detail;

		const el = new SinkItem();
		this.#list.appendChild(el);
		el.setModel(sink);

		if (this.#filterTokens.length !== 0) this.applyFilter();

		// this.orderByRssi();

		el.addEventListener('click', this.sinkClicked);
	}

	sinkDisconnected(evt) {
		// When the sink disconnects - it will advertise a new random address
		// Just remove from the list
		const { sink } = evt.detail;

		const elements = Array.from(this.#list.querySelectorAll('sink-item'));

		elements.find(e => e.getModel() === sink)?.remove();
	}

	sinkUpdated(evt) {
		const { sink } = evt.detail;

		const items = Array.from(this.#list.querySelectorAll('sink-item'));

		const el = items.find(i => i.getModel() === sink);

		if (el) {
			el.refresh();
			// this.orderByRssi();
		} else {
			console.warn('sink not found!', sink);
		}
	}
}
customElements.define('sink-device-list', SinkDeviceList);
