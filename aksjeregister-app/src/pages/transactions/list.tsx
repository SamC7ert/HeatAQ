import { useTable, List, ShowButton, CreateButton } from "@refinedev/antd";
import { Table, Space, Typography, Tag } from "antd";
import type { Transaction } from "../../types/database";

const { Text } = Typography;

const transactionTypeLabels: Record<string, string> = {
  founding: "Stiftelse",
  transfer: "Overføring",
  issue: "Emisjon",
  dividend: "Utbytte",
  inheritance: "Arv",
  gift: "Gave",
  capital_reduction: "Kapitalnedsettelse",
  split: "Aksjesplitt",
  reverse_split: "Aksjespleis",
  merger: "Fusjon",
  demerger: "Fisjon",
};

const transactionTypeColors: Record<string, string> = {
  founding: "green",
  transfer: "blue",
  issue: "purple",
  dividend: "gold",
  inheritance: "cyan",
  gift: "magenta",
  capital_reduction: "red",
  split: "orange",
  reverse_split: "orange",
  merger: "geekblue",
  demerger: "geekblue",
};

export const TransactionList: React.FC = () => {
  const { tableProps } = useTable<Transaction>({
    resource: "transactions",
    syncWithLocation: true,
    sorters: {
      initial: [{ field: "transaction_date", order: "desc" }],
    },
  });

  const formatCurrency = (value?: number) => {
    if (value === undefined || value === null) return "-";
    return new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: "NOK",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("nb-NO");
  };

  return (
    <List headerButtons={<CreateButton>Ny transaksjon</CreateButton>}>
      <Table {...(tableProps as object)} rowKey="id">
        <Table.Column
          dataIndex="transaction_date"
          title="Dato"
          width={120}
          render={(value: string) => formatDate(value)}
        />
        <Table.Column
          dataIndex="transaction_type"
          title="Type"
          width={140}
          render={(value: string) => (
            <Tag color={transactionTypeColors[value] || "default"}>
              {transactionTypeLabels[value] || value}
            </Tag>
          )}
        />
        <Table.Column
          dataIndex="description"
          title="Beskrivelse"
          render={(value: string) => value || <Text type="secondary">-</Text>}
        />
        <Table.Column
          dataIndex="shares_before"
          title="Aksjer før"
          width={110}
          render={(value: number) => value?.toLocaleString("nb-NO")}
        />
        <Table.Column
          dataIndex="shares_after"
          title="Aksjer etter"
          width={110}
          render={(value: number) => value?.toLocaleString("nb-NO")}
        />
        <Table.Column
          title="Endring"
          width={100}
          render={(_: unknown, record: Transaction) => {
            const diff = record.shares_after - record.shares_before;
            if (diff === 0) return <Text type="secondary">0</Text>;
            return (
              <Text type={diff > 0 ? "success" : "danger"}>
                {diff > 0 ? "+" : ""}
                {diff.toLocaleString("nb-NO")}
              </Text>
            );
          }}
        />
        <Table.Column
          dataIndex="total_amount"
          title="Beløp"
          width={140}
          render={(value: number) => formatCurrency(value)}
        />
        <Table.Column
          title="Handlinger"
          width={100}
          render={(_: unknown, record: Transaction) => (
            <Space>
              <ShowButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
