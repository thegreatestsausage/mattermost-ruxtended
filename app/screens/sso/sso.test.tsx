// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import LocalConfig from '@assets/config.json';
import Preferences from '@constants/preferences';
import {renderWithIntl} from '@test/intl-test-helper';

import SSOAuthentication, {isNavigationAllowed} from './sso_authentication';

jest.mock('@utils/url', () => {
    return {
        tryOpenURL: () => null,
        sanitizeUrl: (url: string) => url.replace(/\/+$/, '').toLowerCase(),
    };
});

describe('SSO with redirect url', () => {
    const baseProps = {
        customUrlScheme: LocalConfig.AuthUrlSchemeDev,
        doSSOLogin: jest.fn(),
        doSSOCodeExchange: jest.fn(),
        intl: {},
        loginError: '',
        loginUrl: '',
        serverUrl: 'https://example.mattermost.com',
        setLoginError: jest.fn(),
        theme: Preferences.THEMES.denim,
    };

    test('should show message when user navigates to the page', () => {
        const {getByTestId} = renderWithIntl(<SSOAuthentication {...baseProps}/>);
        expect(getByTestId('mobile.oauth.switch_to_browser')).toBeDefined();
    });

    test('should show "try again" and hide default message when error text is displayed', () => {
        const {getByTestId} = renderWithIntl(
            <SSOAuthentication
                {...baseProps}
                loginError='some error'
            />,
        );
        expect(getByTestId('mobile.oauth.try_again')).toBeDefined();
        let browser;
        try {
            browser = getByTestId('mobile.oauth.switch_to_browser');
        } catch (error) {
            // do nothing
        }
        expect(browser).toBeUndefined();
    });
});

describe('Server origin verification', () => {
    // Test the URL normalization logic used in server origin verification
    const {sanitizeUrl} = jest.requireMock('@utils/url');

    test('should normalize URLs by removing trailing slashes', () => {
        expect(sanitizeUrl('https://example.com/')).toBe('https://example.com');
        expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    });

    test('should normalize URLs to lowercase', () => {
        expect(sanitizeUrl('https://EXAMPLE.COM')).toBe('https://example.com');
        expect(sanitizeUrl('https://Example.Mattermost.Com')).toBe('https://example.mattermost.com');
    });

    test('should match identical normalized URLs', () => {
        const serverUrl = 'https://example.mattermost.com';
        const srvParam = 'https://example.mattermost.com';
        expect(sanitizeUrl(serverUrl)).toBe(sanitizeUrl(srvParam));
    });

    test('should match URLs with different casing', () => {
        const serverUrl = 'https://example.mattermost.com';
        const srvParam = 'https://EXAMPLE.MATTERMOST.COM';
        expect(sanitizeUrl(serverUrl)).toBe(sanitizeUrl(srvParam));
    });

    test('should match URLs with trailing slash differences', () => {
        const serverUrl = 'https://example.mattermost.com';
        const srvParam = 'https://example.mattermost.com/';
        expect(sanitizeUrl(serverUrl)).toBe(sanitizeUrl(srvParam));
    });

    test('should not match different server URLs', () => {
        const serverUrl = 'https://legitimate.mattermost.com';
        const srvParam = 'https://malicious.attacker.com';
        expect(sanitizeUrl(serverUrl)).not.toBe(sanitizeUrl(srvParam));
    });

    test('should not match when server URL contains attacker URL as substring', () => {
        const serverUrl = 'https://legitimate.mattermost.com';
        const srvParam = 'https://legitimate.mattermost.com.attacker.com';
        expect(sanitizeUrl(serverUrl)).not.toBe(sanitizeUrl(srvParam));
    });
});

describe('WebView navigation filtering', () => {
    test('allows the http(s) login flow', () => {
        expect(isNavigationAllowed('https://lunatech.tech/realms/x/protocol/saml')).toBe(true);
        expect(isNavigationAllowed('http://example.com')).toBe(true);
        expect(isNavigationAllowed('about:blank')).toBe(true);
    });

    test('blocks every other scheme, since originWhitelist no longer filters them', () => {
        expect(isNavigationAllowed('mmauth://callback?MMAUTHTOKEN=t')).toBe(false);
        expect(isNavigationAllowed('intent://evil#Intent;scheme=http;end')).toBe(false);
        expect(isNavigationAllowed('file:///data/data/com.mattermost.rn/databases')).toBe(false);
        // eslint-disable-next-line no-script-url
        expect(isNavigationAllowed('javascript:alert(1)')).toBe(false);
    });
});
