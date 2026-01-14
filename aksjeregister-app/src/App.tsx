import { Refine, Authenticated } from "@refinedev/core";
import { ThemedLayout, useNotificationProvider, AuthPage } from "@refinedev/antd";
import { dataProvider, liveProvider } from "@refinedev/supabase";
import routerProvider, {
  NavigateToResource,
  CatchAllNavigate,
  UnsavedChangesNotifier,
  DocumentTitleHandler,
} from "@refinedev/react-router";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { ConfigProvider, App as AntdApp } from "antd";
import nbNO from "antd/locale/nb_NO";
import {
  BankOutlined,
  UserOutlined,
  SwapOutlined,
  FileTextOutlined,
} from "@ant-design/icons";

import "@refinedev/antd/dist/reset.css";

import { supabaseClient } from "./supabaseClient";
import { authProvider } from "./providers/authProvider";
import { Header } from "./components/layout/Header";

// Pages
import { CompanyList } from "./pages/companies/list";
import { CompanyCreate } from "./pages/companies/create";
import { CompanyShow } from "./pages/companies/show";
import { ShareholderList } from "./pages/shareholders/list";
import { ShareholderCreate } from "./pages/shareholders/create";
import { TransactionList } from "./pages/transactions/list";
import { TransactionCreate } from "./pages/transactions/create";
import { TransactionShow } from "./pages/transactions/show";

function App() {
  return (
    <BrowserRouter>
      <ConfigProvider locale={nbNO}>
        <AntdApp>
          <Refine
            dataProvider={dataProvider(supabaseClient)}
            liveProvider={liveProvider(supabaseClient)}
            authProvider={authProvider}
            routerProvider={routerProvider}
            notificationProvider={useNotificationProvider}
            resources={[
              {
                name: "companies",
                list: "/companies",
                create: "/companies/create",
                show: "/companies/show/:id",
                meta: {
                  label: "Selskaper",
                  icon: <BankOutlined />,
                },
              },
              {
                name: "shareholders",
                list: "/shareholders",
                create: "/shareholders/create",
                meta: {
                  label: "Aksjonærer",
                  icon: <UserOutlined />,
                },
              },
              {
                name: "transactions",
                list: "/transactions",
                create: "/transactions/create",
                show: "/transactions/show/:id",
                meta: {
                  label: "Transaksjoner",
                  icon: <SwapOutlined />,
                },
              },
              {
                name: "reports",
                list: "/reports",
                meta: {
                  label: "Rapporter",
                  icon: <FileTextOutlined />,
                },
              },
            ]}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
              title: {
                text: "Aksjeregister",
                icon: <BankOutlined />,
              },
            }}
          >
            <Routes>
              <Route
                element={
                  <Authenticated
                    key="authenticated-inner"
                    fallback={<CatchAllNavigate to="/login" />}
                  >
                    <ThemedLayout Header={() => <Header />}>
                      <Outlet />
                    </ThemedLayout>
                  </Authenticated>
                }
              >
                <Route index element={<NavigateToResource resource="companies" />} />

                {/* Companies */}
                <Route path="/companies">
                  <Route index element={<CompanyList />} />
                  <Route path="create" element={<CompanyCreate />} />
                  <Route path="show/:id" element={<CompanyShow />} />
                </Route>

                {/* Shareholders */}
                <Route path="/shareholders">
                  <Route index element={<ShareholderList />} />
                  <Route path="create" element={<ShareholderCreate />} />
                </Route>

                {/* Transactions */}
                <Route path="/transactions">
                  <Route index element={<TransactionList />} />
                  <Route path="create" element={<TransactionCreate />} />
                  <Route path="show/:id" element={<TransactionShow />} />
                </Route>

                <Route path="*" element={<NavigateToResource resource="companies" />} />
              </Route>

              {/* Auth routes */}
              <Route
                element={
                  <Authenticated key="authenticated-outer" fallback={<Outlet />}>
                    <NavigateToResource />
                  </Authenticated>
                }
              >
                <Route
                  path="/login"
                  element={
                    <AuthPage
                      type="login"
                      title="Aksjeregister"
                      formProps={{
                        initialValues: {
                          email: "",
                          password: "",
                        },
                      }}
                      registerLink="/register"
                      forgotPasswordLink="/forgot-password"
                    />
                  }
                />
                <Route
                  path="/register"
                  element={
                    <AuthPage
                      type="register"
                      title="Aksjeregister"
                      loginLink="/login"
                    />
                  }
                />
                <Route
                  path="/forgot-password"
                  element={
                    <AuthPage
                      type="forgotPassword"
                      title="Aksjeregister"
                      loginLink="/login"
                    />
                  }
                />
              </Route>
            </Routes>

            <UnsavedChangesNotifier />
            <DocumentTitleHandler />
          </Refine>
        </AntdApp>
      </ConfigProvider>
    </BrowserRouter>
  );
}

export default App;
