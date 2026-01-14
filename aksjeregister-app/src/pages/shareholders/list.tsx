import { useTable, List, CreateButton, ShowButton } from "@refinedev/antd";
import { Table, Space, Typography, Tag } from "antd";
import { UserOutlined, BankOutlined } from "@ant-design/icons";
import type { Shareholder } from "../../types/database";

const { Text } = Typography;

export const ShareholderList: React.FC = () => {
  const { tableProps } = useTable<Shareholder>({
    resource: "shareholders",
    syncWithLocation: true,
  });

  const formatDate = (dateString?: string) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("nb-NO");
  };

  return (
    <List headerButtons={<CreateButton>Ny aksjonær</CreateButton>}>
      <Table {...(tableProps as object)} rowKey="id">
        <Table.Column
          dataIndex="shareholder_type"
          title="Type"
          width={100}
          render={(value: string) => (
            <Tag
              icon={value === "person" ? <UserOutlined /> : <BankOutlined />}
              color={value === "person" ? "blue" : "green"}
            >
              {value === "person" ? "Person" : "Selskap"}
            </Tag>
          )}
        />
        <Table.Column
          dataIndex="name"
          title="Navn"
          render={(value: string) => <Text strong>{value}</Text>}
        />
        <Table.Column
          dataIndex="org_number"
          title="Org.nr. / Fødselsdato"
          render={(_: unknown, record: Shareholder) => {
            if (record.shareholder_type === "company") {
              return record.org_number ? <Text code>{record.org_number}</Text> : "-";
            }
            return formatDate(record.birth_date ?? undefined);
          }}
        />
        <Table.Column
          dataIndex="city"
          title="Sted"
          render={(value: string, record: Shareholder) =>
            value ? `${record.postal_code || ""} ${value}`.trim() : "-"
          }
        />
        <Table.Column
          dataIndex="country"
          title="Land"
          width={80}
          render={(value: string) => <Tag>{value || "NO"}</Tag>}
        />
        <Table.Column dataIndex="email" title="E-post" render={(v: string) => v || "-"} />
        <Table.Column
          title="Handlinger"
          width={100}
          render={(_: unknown, record: Shareholder) => (
            <Space>
              <ShowButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
