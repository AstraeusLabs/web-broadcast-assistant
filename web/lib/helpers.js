/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const compareTypedArray = (arr1, arr2) => {
        if (arr1.constructor.name !== arr2.constructor.name) {
                throw new Error(`Inputs must be of same type (${arr1.constructor.name} != ${arr2.constructor.name})`);
        }

        if (arr1.length !== arr2.length) {
                return false;
        }

        return arr1.every((value, index) => value === arr2[index]);
}

export const arrayToHex = arr => {
        return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join(', ');
}
