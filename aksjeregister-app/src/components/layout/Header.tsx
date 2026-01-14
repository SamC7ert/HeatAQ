import { useGetIdentity, useLogout } from "@refinedev/core";
import { Layout, Space, Typography, Avatar, Dropdown, theme } from "antd";
import { UserOutlined, LogoutOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";

const { Text } = Typography;
const { useToken } = theme;

interface IUser {
  id: string;
  name: string;
  email: string;
}

export const Header: React.FC = () => {
  const { token } = useToken();
  const { data: user } = useGetIdentity<IUser>();
  const { mutate: logout } = useLogout();

  const menuItems: MenuProps["items"] = [
    {
      key: "logout",
      label: "Logg ut",
      icon: <LogoutOutlined />,
      onClick: () => logout(),
    },
  ];

  return (
    <Layout.Header
      style={{
        backgroundColor: token.colorBgElevated,
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "0px 24px",
        height: "64px",
        position: "sticky",
        top: 0,
        zIndex: 1,
      }}
    >
      <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
        <Space style={{ cursor: "pointer" }}>
          <Text strong>{user?.name}</Text>
          <Avatar
            style={{ backgroundColor: token.colorPrimary }}
            icon={<UserOutlined />}
          />
        </Space>
      </Dropdown>
    </Layout.Header>
  );
};
