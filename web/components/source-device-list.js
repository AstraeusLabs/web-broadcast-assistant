/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as AssistantModel from '../models/assistant-model.js';

import { SourceItem } from './source-item.js';

/**
Source Device List Component
*/

const template = document.createElement('template');
template.innerHTML = `
<style>
/* Styles go here */

#scan {
	border-radius: 20px;
}

#container {
	display: flex;
	flex-direction: column;
}

#list {
	display: flex;
	flex-direction: column;
}

input {
	font-size: 1.2em;
}

.hidden {
	display: none;
}
</style>
<div id="container">
<h2>Source list</h2>
<input id="filter" placeholder="Filter...">
<div id="list">
</div>
</div>
`;

export class SourceDeviceList extends HTMLElement {
	#list
	#model
	#filterTokens


	constructor() {
		super();

		this.#filterTokens = [];
		this.setFilter = this.setFilter.bind(this);
		this.applyFilter = this.applyFilter.bind(this);

		this.sourceFound = this.sourceFound.bind(this);
		this.sourceUpdated = this.sourceUpdated.bind(this);
		this.baseUpdated = this.baseUpdated.bind(this);
		this.sourceClicked = this.sourceClicked.bind(this);

		const shadowRoot = this.attachShadow({mode: 'open'});
	}

	connectedCallback() {
		console.log("connectedCallback - SourceDeviceList");

		this.shadowRoot?.appendChild(template.content.cloneNode(true));
		// Add listeners, etc.
		this.#list = this.shadowRoot?.querySelector('#list');
		this.shadowRoot?.querySelector('#filter')?.addEventListener('input', evt => { this.setFilter(evt?.target.value) } );

		this.#model = AssistantModel.getInstance();

		this.#model.addEventListener('source-found', this.sourceFound);
		this.#model.addEventListener('source-updated', this.sourceUpdated);
		this.#model.addEventListener('base-updated', this.baseUpdated);
		this.#model.addEventListener('reset', () => { this.#list.replaceChildren()})
	}

	disconnectedCallback() {
		// Remove listeners, etc.
	}

	sourceClicked(evt) {
		const sourceEl = evt.target;
		// If a source is clicked, a request is sent to the (USB) attached broadcast
		// assistant device.

		// TBD: Mark the source item as selected (maybe in a pending state until RES)

		// When a source is successfully added to a sink, an event should
		// be sent from the attached assistant device to allow e.g. the broadcast ID
		// to be shown on the attached sink(s)

		const source = sourceEl.getModel();

		console.log('Source clicked:', sourceEl.getModel());

		if (source.state === "selected") {
			this.#model.removeSource(source);
		} else {
			this.#model.addSource(source);
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
		const elements = Array.from(this.#list.querySelectorAll('source-item'));

		if (this.#filterTokens.length === 0) {
			// Remove 'hidden' class from all items
			elements.forEach( i => { i.classList.remove('hidden') } );
			return;
		}

		let found = elements;

		for (const t of this.#filterTokens) {
			found = found.filter(i => i.getModel().addr?.value.addrStr.toLowerCase().includes(t) ||
				i.getModel().name?.toLowerCase().includes(t) ||
				i.getModel().broadcast_name?.toLowerCase().includes(t));
		}

		elements.forEach( i => {
			if (found.includes(i)) {
				i.classList.remove('hidden');
			} else {
				i.classList.add('hidden');
			}
		});
	}

	sourceFound(evt) {
		// Assume that the AssistantModel has eliminated duplicates
		// If the addr is random and RPA changed, device will appear
		// As duplicate and the old entry will stay (stale)
		// TODO: Possibly remove stale entries - however, this should
		// not be a big issue.
		const { source } = evt.detail;

		const el = new SourceItem();
		this.#list.appendChild(el);
		el.setModel(source);

		el.addEventListener('click', this.sourceClicked);
	}

	sourceUpdated(evt) {
		const { source } = evt.detail;

		const items = Array.from(this.#list.querySelectorAll('source-item'));

		const el = items.find(i => i.getModel() === source);

		if (el) {
			el.refresh();
		} else {
			console.warn('source not found!', source);
		}
	}

	baseUpdated(evt) {
		const { source } = evt.detail;

		const items = Array.from(this.#list.querySelectorAll('source-item'));

		const el = items.find(i => i.getModel() === source);

		if (el) {
			el.baseUpdated();
		} else {
			console.warn('source not found!', source);
		}
	}
}


customElements.define('source-device-list', SourceDeviceList);
