import { List, useTable, ShowButton, CreateButton } from "@refinedev/antd";
import { Table, Space, Typography } from "antd";
import type { Company } from "../../types/database";

const { Text } = Typography;

export const CompanyList: React.FC = () => {
  const { tableProps } = useTable<Company>({
    resource: "companies",
    syncWithLocation: true,
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: "NOK",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <List headerButtons={<CreateButton>Nytt selskap</CreateButton>}>
      <Table {...(tableProps as object)} rowKey="id">
        <Table.Column
          dataIndex="name"
          title="Selskapsnavn"
          render={(value: string) => <Text strong>{value}</Text>}
        />
        <Table.Column
          dataIndex="org_number"
          title="Org.nr."
          render={(value: string) => <Text code>{value}</Text>}
        />
        <Table.Column
          dataIndex="share_capital"
          title="Aksjekapital"
          render={(value: number) => formatCurrency(value)}
        />
        <Table.Column
          dataIndex="total_shares"
          title="Antall aksjer"
          render={(value: number) => value?.toLocaleString("nb-NO")}
        />
        <Table.Column
          dataIndex="par_value"
          title="Pålydende"
          render={(value: number) => formatCurrency(value)}
        />
        <Table.Column dataIndex="city" title="Sted" />
        <Table.Column
          title="Handlinger"
          render={(_: unknown, record: Company) => (
            <Space>
              <ShowButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
