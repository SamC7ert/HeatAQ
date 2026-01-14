import { useShow, useList } from "@refinedev/core";
import { Show, ListButton } from "@refinedev/antd";
import { Typography, Card, Row, Col, Descriptions, Table, Tag, Statistic, Space } from "antd";
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from "@ant-design/icons";
import type { Transaction, TransactionLine, Document as DocType } from "../../types/database";

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
};

export const TransactionShow: React.FC = () => {
  const { query } = useShow<Transaction>();
  const { data, isLoading } = query;
  const record = data?.data;

  // Fetch transaction lines
  const { result: linesResult } = useList<TransactionLine>({
    resource: "transaction_lines",
    filters: [
      { field: "transaction_id", operator: "eq", value: record?.id },
    ],
    queryOptions: {
      enabled: !!record?.id,
    },
  });

  // Fetch documents
  const { result: docsResult } = useList<DocType>({
    resource: "documents",
    filters: [
      { field: "transaction_id", operator: "eq", value: record?.id },
    ],
    queryOptions: {
      enabled: !!record?.id,
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

  const shareChange = (record?.shares_after || 0) - (record?.shares_before || 0);
  const capitalChange = (record?.capital_after || 0) - (record?.capital_before || 0);

  return (
    <Show isLoading={isLoading} headerButtons={<ListButton />}>
      <Row gutter={[24, 24]}>
        {/* Header with type */}
        <Col span={24}>
          <Space>
            <Tag
              color={transactionTypeColors[record?.transaction_type || ""] || "default"}
              style={{ fontSize: 16, padding: "4px 12px" }}
            >
              {transactionTypeLabels[record?.transaction_type || ""] || record?.transaction_type}
            </Tag>
            <Text type="secondary">
              {formatDate(record?.transaction_date)}
            </Text>
          </Space>
        </Col>

        {/* Summary Stats */}
        <Col span={24}>
          <Card>
            <Row gutter={48}>
              <Col span={6}>
                <Statistic
                  title="Aksjer før"
                  value={record?.shares_before || 0}
                  groupSeparator=" "
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Aksjer etter"
                  value={record?.shares_after || 0}
                  groupSeparator=" "
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Endring"
                  value={shareChange}
                  groupSeparator=" "
                  valueStyle={{
                    color: shareChange > 0 ? "#52c41a" : shareChange < 0 ? "#ff4d4f" : "#8c8c8c",
                  }}
                  prefix={
                    shareChange > 0 ? (
                      <ArrowUpOutlined />
                    ) : shareChange < 0 ? (
                      <ArrowDownOutlined />
                    ) : (
                      <MinusOutlined />
                    )
                  }
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Totalbeløp"
                  value={record?.total_amount || 0}
                  groupSeparator=" "
                  suffix="NOK"
                />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* Details */}
        <Col span={12}>
          <Card title="Detaljer">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Beskrivelse">
                {record?.description || <Text type="secondary">Ingen beskrivelse</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Vedtaksdato">
                {formatDate(record?.decision_date ?? undefined)}
              </Descriptions.Item>
              <Descriptions.Item label="Registreringsdato">
                {formatDate(record?.effective_date ?? undefined)}
              </Descriptions.Item>
              {record?.price_per_share && (
                <Descriptions.Item label="Pris per aksje">
                  {formatCurrency(record.price_per_share)}
                </Descriptions.Item>
              )}
              {record?.dividend_per_share && (
                <Descriptions.Item label="Utbytte per aksje">
                  {formatCurrency(record.dividend_per_share)}
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Col>

        {/* Capital Changes */}
        <Col span={12}>
          <Card title="Aksjekapital">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Kapital før">
                {formatCurrency(record?.capital_before)}
              </Descriptions.Item>
              <Descriptions.Item label="Kapital etter">
                {formatCurrency(record?.capital_after)}
              </Descriptions.Item>
              <Descriptions.Item label="Endring">
                <Text
                  type={capitalChange > 0 ? "success" : capitalChange < 0 ? "danger" : "secondary"}
                >
                  {capitalChange > 0 ? "+" : ""}
                  {formatCurrency(capitalChange)}
                </Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        {/* Transaction Lines */}
        {linesResult?.data && linesResult.data.length > 0 && (
          <Col span={24}>
            <Card title="Transaksjonslinjer">
              <Table
                dataSource={linesResult.data}
                rowKey="id"
                pagination={false}
                size="small"
              >
                <Table.Column
                  title="Aksjonær"
                  dataIndex="shareholder_id"
                />
                <Table.Column
                  title="Retning"
                  dataIndex="direction"
                  render={(value) => (
                    <Tag color={value === "in" ? "green" : "red"}>
                      {value === "in" ? "Tilgang" : "Avgang"}
                    </Tag>
                  )}
                />
                <Table.Column
                  title="Antall aksjer"
                  dataIndex="num_shares"
                  render={(value) => value?.toLocaleString("nb-NO")}
                />
                <Table.Column
                  title="Aksjenumre"
                  dataIndex="share_numbers_text"
                  render={(value) => value || "-"}
                />
                <Table.Column
                  title="Beløp"
                  dataIndex="amount"
                  render={(value) => formatCurrency(value)}
                />
              </Table>
            </Card>
          </Col>
        )}

        {/* Documents */}
        {docsResult?.data && docsResult.data.length > 0 && (
          <Col span={24}>
            <Card title="Dokumenter">
              <Table
                dataSource={docsResult.data}
                rowKey="id"
                pagination={false}
                size="small"
              >
                <Table.Column title="Navn" dataIndex="name" />
                <Table.Column title="Type" dataIndex="document_type" />
                <Table.Column
                  title="Opplastet"
                  dataIndex="uploaded_at"
                  render={(value) => formatDate(value)}
                />
              </Table>
            </Card>
          </Col>
        )}
      </Row>
    </Show>
  );
};
