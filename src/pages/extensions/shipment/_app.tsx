import { Theme } from "@material-ui/core/styles";
import { AppBridge, AppBridgeProvider } from "@saleor/app-sdk/app-bridge";
import { ThemeProvider as MacawUIThemeProvider } from "@saleor/macaw-ui";
import { AppProps } from "next/app";
import React, { PropsWithChildren, useEffect } from "react";
import { GraphQLProvider } from "../../../providers/GraphQLProvider";

const themeOverrides: Partial<Theme> = {
  /**
   * You can override MacawUI theme here
   */
};

/**
 * Ensure instance is a singleton.
 * TODO: This is React 18 issue, consider hiding this workaround inside app-sdk
 */
const appBridgeInstance = typeof window !== "undefined" ? new AppBridge() : undefined;

/**
 * That's a hack required by Macaw-UI incompatibility with React@18
 */
const ThemeProvider = MacawUIThemeProvider as React.FC<
  PropsWithChildren<{ overrides?: Partial<Theme>; ssr: boolean }>
>;

function NextApp({ Component, pageProps }: AppProps) {
  /**
   * Configure JSS (used by MacawUI) for SSR. If Macaw is not used, can be removed.
   */
  useEffect(() => {
    const jssStyles = document.querySelector("#jss-server-side");
    if (jssStyles) {
      jssStyles?.parentElement?.removeChild(jssStyles);
    }
  }, []);

  return (
    <AppBridgeProvider appBridgeInstance={appBridgeInstance}>
      <GraphQLProvider>
        <ThemeProvider overrides={themeOverrides} ssr>
          <Component {...pageProps} />
        </ThemeProvider>
      </GraphQLProvider>
    </AppBridgeProvider>
  );
}

export default NextApp;