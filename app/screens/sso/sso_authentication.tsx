// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {openAuthSessionAsync} from 'expo-web-browser';
import qs from 'querystringify';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useIntl} from 'react-intl';
import {Platform, StyleSheet, View} from 'react-native';
import {WebView} from 'react-native-webview';
import urlParse from 'url-parse';

import {Sso} from '@constants';
import {isBetaApp} from '@utils/general';
import {createSamlChallenge} from '@utils/saml_challenge';
import {sanitizeUrl} from '@utils/url';

import AuthError from './components/auth_error';
import AuthRedirect from './components/auth_redirect';
import AuthSuccess from './components/auth_success';

import type {ShouldStartLoadRequest, WebViewErrorEvent} from 'react-native-webview/lib/WebViewTypes';

interface SSOAuthenticationProps {
    doSSOLogin: (bearerToken: string, csrfToken: string) => void;
    doSSOCodeExchange: (loginCode: string, samlChallenge: {codeVerifier: string; state: string}) => void;
    loginError: string;
    loginUrl: string;
    serverUrl: string;
    setLoginError: (value: string) => void;
    theme: Theme;
}

// originWhitelist is '*' so that the mmauth:// callback reaches onShouldStartLoadWithRequest
// at all: react-native-webview hands non-whitelisted URLs to Linking.openURL instead, which
// would both lose the callback and broadcast the token as an Android intent. The whitelist
// therefore no longer filters anything and this does it instead -- only the login flow loads.
export const isNavigationAllowed = (url: string): boolean =>
    url.startsWith('https://') || url.startsWith('http://') || url === 'about:blank';

const style = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: 24,
    },
    webViewContainer: {
        flex: 1,
    },
});

const SSOAuthentication = ({doSSOLogin, doSSOCodeExchange, loginError, loginUrl, serverUrl, setLoginError, theme}: SSOAuthenticationProps) => {
    const [error, setError] = useState<string>('');
    const [loginSuccess, setLoginSuccess] = useState(false);

    // Bumping this remounts the WebView, which is how retry reloads the login page.
    const [reloadKey, setReloadKey] = useState(0);
    const intl = useIntl();
    let customUrlScheme = Sso.REDIRECT_URL_SCHEME;
    if (isBetaApp) {
        customUrlScheme = Sso.REDIRECT_URL_SCHEME_DEV;
    }

    const redirectUrl = customUrlScheme + 'callback';
    const samlChallenge = useMemo(() => createSamlChallenge(), []);

    // Verify that the srv parameter from the callback matches the expected server
    const verifyServerOrigin = useCallback((srvParam: string | undefined): boolean => {
        if (!srvParam) {
            // Old servers don't send srv parameter - allow for backwards compatibility
            return true;
        }
        const normalizedExpected = sanitizeUrl(serverUrl);
        const normalizedActual = sanitizeUrl(srvParam);
        return normalizedExpected === normalizedActual;
    }, [serverUrl]);

    const authUrl = useMemo(() => {
        const parsedUrl = urlParse(loginUrl, true);
        const query: Record<string, string> = {
            ...parsedUrl.query,
            redirect_to: redirectUrl,
            state: samlChallenge.state,
            code_challenge: samlChallenge.codeChallenge,
            code_challenge_method: samlChallenge.method,
        };
        parsedUrl.set('query', qs.stringify(query));
        return parsedUrl.toString();
    }, [loginUrl, redirectUrl, samlChallenge]);

    // The one place that turns a callback URL into a session. Returns false when the URL
    // carried nothing usable and no error was raised, so the caller decides what to show:
    // iOS stays silent there, as it always has, while Android reports a failed login.
    const handleCallbackUrl = useCallback((url: string): boolean => {
        const parsedUrl = urlParse(url, true);
        const srvParam = parsedUrl.query?.srv as string | undefined;

        // Verify server origin before accepting credentials
        if (!verifyServerOrigin(srvParam)) {
            setError(
                intl.formatMessage({
                    id: 'mobile.oauth.server_mismatch',
                    defaultMessage: 'Login failed: Unable to complete authentication with this server. Please try again.',
                }),
            );
            return true;
        }

        const loginCode = parsedUrl.query?.login_code as string | undefined;
        if (loginCode) {
            // Prefer code exchange when available
            setLoginSuccess(true);
            doSSOCodeExchange(loginCode, {codeVerifier: samlChallenge.codeVerifier, state: samlChallenge.state});
            return true;
        }

        const bearerToken = parsedUrl.query?.MMAUTHTOKEN;
        const csrfToken = parsedUrl.query?.MMCSRF;
        if (bearerToken && csrfToken) {
            setLoginSuccess(true);
            doSSOLogin(bearerToken, csrfToken);
            return true;
        }

        return false;
    }, [doSSOCodeExchange, doSSOLogin, intl, samlChallenge, verifyServerOrigin]);

    const failedToLogin = useCallback(() => {
        setError(
            intl.formatMessage({
                id: 'mobile.oauth.failed_to_login',
                defaultMessage: 'Your login attempt failed. Please try again.',
            }),
        );
    }, [intl]);

    // iOS keeps using the system auth session. Only Android moves in-app, because a Custom
    // Tab runs inside Chrome and so never sees this app's network security config, which
    // makes the bundled Ministry of Digital Development anchors invisible to it.
    const init = useCallback(async (resetErrors = true) => {
        setLoginSuccess(false);
        if (resetErrors !== false) {
            setError('');
            setLoginError('');
        }
        const result = await openAuthSessionAsync(authUrl, null, {preferEphemeralSession: true, createTask: false});
        if ('url' in result && result.url) {
            handleCallbackUrl(result.url);
        } else {
            failedToLogin();
        }
    }, [authUrl, failedToLogin, handleCallbackUrl, setLoginError]);

    const onRetry = useCallback(() => {
        setError('');
        setLoginError('');
        setLoginSuccess(false);
        if (Platform.OS === 'ios') {
            init();
        } else {
            setReloadKey((k) => k + 1);
        }
    }, [init, setLoginError]);

    const onShouldStartLoadWithRequest = useCallback((request: ShouldStartLoadRequest) => {
        const {url} = request;
        if (url.startsWith(redirectUrl)) {
            if (!handleCallbackUrl(url)) {
                failedToLogin();
            }
            return false;
        }

        return isNavigationAllowed(url);
    }, [failedToLogin, handleCallbackUrl, redirectUrl]);

    const onWebViewError = useCallback((event: WebViewErrorEvent) => {
        setError(event.nativeEvent.description || intl.formatMessage({
            id: 'mobile.oauth.failed_to_login',
            defaultMessage: 'Your login attempt failed. Please try again.',
        }));
    }, [intl]);

    const renderLoading = useCallback(() => (<AuthRedirect theme={theme}/>), [theme]);

    useEffect(() => {
        if (Platform.OS !== 'ios') {
            return undefined;
        }

        const timeout = setTimeout(() => {
            init(false);
        }, 1000);

        return () => clearTimeout(timeout);
    }, [init]);

    if (Platform.OS === 'android' && !loginSuccess && !loginError && !error) {
        return (
            <View
                style={style.webViewContainer}
                testID='sso.redirect_url'
            >
                <WebView
                    key={reloadKey}
                    source={{uri: authUrl}}
                    originWhitelist={['*']}
                    onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
                    onError={onWebViewError}
                    incognito={true}
                    startInLoadingState={true}
                    renderLoading={renderLoading}
                />
            </View>
        );
    }

    let content;
    if (loginSuccess) {
        content = (<AuthSuccess theme={theme}/>);
    } else if (loginError || error) {
        content = (
            <AuthError
                error={loginError || error}
                retry={onRetry}
                theme={theme}
            />
        );
    } else {
        content = (<AuthRedirect theme={theme}/>);
    }

    return (
        <View
            style={style.container}
            testID='sso.redirect_url'
        >
            {content}
        </View>
    );
};

export default SSOAuthentication;
