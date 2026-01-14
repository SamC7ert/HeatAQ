import { Create, useForm, useSelect } from "@refinedev/antd";
import { Form, Input, Select, DatePicker, Row, Col, Card, InputNumber, Typography, Divider } from "antd";
import { useSearchParams } from "react-router-dom";
import type { Transaction, Company, TransactionType } from "../../types/database";

const { TextArea } = Input;
const { Text } = Typography;
const { Option } = Select;

const transactionTypes: { value: TransactionType; label: string; description: string }[] = [
  { value: "founding", label: "Stiftelse", description: "Registrer selskapets stiftelse med initiale aksjonærer" },
  { value: "transfer", label: "Overføring/Salg", description: "Overfør aksjer mellom aksjonærer" },
  { value: "issue", label: "Emisjon", description: "Utsted nye aksjer (kapitalforhøyelse)" },
  { value: "dividend", label: "Utbytte", description: "Registrer utbytteutdeling til aksjonærer" },
];

export const TransactionCreate: React.FC = () => {
  const [searchParams] = useSearchParams();
  const companyIdFromUrl = searchParams.get("company_id");

  const { formProps, saveButtonProps, form } = useForm<Transaction>({
    redirect: "show",
  });

  const { selectProps: companySelectProps } = useSelect<Company>({
    resource: "companies",
    optionLabel: "name",
    optionValue: "id",
    defaultValue: companyIdFromUrl || undefined,
  });

  const selectedType = Form.useWatch("transaction_type", form);

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        initialValues={{
          company_id: companyIdFromUrl,
          shares_before: 0,
          shares_after: 0,
          capital_before: 0,
          capital_after: 0,
        }}
      >
        <Row gutter={24}>
          <Col span={12}>
            <Card title="Grunnleggende informasjon" size="small">
              <Form.Item
                label="Selskap"
                name="company_id"
                rules={[{ required: true, message: "Velg et selskap" }]}
              >
                <Select
                  {...(companySelectProps as object)}
                  placeholder="Velg selskap"
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                />
              </Form.Item>

              <Form.Item
                label="Transaksjonstype"
                name="transaction_type"
                rules={[{ required: true, message: "Velg type" }]}
              >
                <Select placeholder="Velg transaksjonstype">
                  {transactionTypes.map((t) => (
                    <Option key={t.value} value={t.value}>
                      <div>
                        <Text strong>{t.label}</Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t.description}
                        </Text>
                      </div>
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                label="Transaksjonsdato"
                name="transaction_date"
                rules={[{ required: true, message: "Velg dato" }]}
              >
                <DatePicker style={{ width: "100%" }} format="DD.MM.YYYY" />
              </Form.Item>
            </Card>
          </Col>

          <Col span={12}>
            <Card title="Detaljer" size="small">
              <Form.Item label="Beskrivelse" name="description">
                <TextArea
                  rows={3}
                  placeholder="Kort beskrivelse av transaksjonen..."
                />
              </Form.Item>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="Vedtaksdato" name="decision_date">
                    <DatePicker style={{ width: "100%" }} format="DD.MM.YYYY" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Registreringsdato" name="effective_date">
                    <DatePicker style={{ width: "100%" }} format="DD.MM.YYYY" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        <Divider />

        <Card title="Aksjekapital før og etter" size="small">
          <Row gutter={24}>
            <Col span={6}>
              <Form.Item
                label="Aksjer før"
                name="shares_before"
                rules={[{ required: true }]}
              >
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                label="Aksjer etter"
                name="shares_after"
                rules={[{ required: true }]}
              >
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                label="Kapital før (NOK)"
                name="capital_before"
                rules={[{ required: true }]}
              >
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                label="Kapital etter (NOK)"
                name="capital_after"
                rules={[{ required: true }]}
              >
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {(selectedType === "transfer" || selectedType === "issue") && (
          <Card title="Beløp" size="small" style={{ marginTop: 16 }}>
            <Row gutter={24}>
              <Col span={8}>
                <Form.Item label="Pris per aksje (NOK)" name="price_per_share">
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    precision={2}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Totalbeløp (NOK)" name="total_amount">
                  <InputNumber style={{ width: "100%" }} min={0} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        )}

        {selectedType === "dividend" && (
          <Card title="Utbytte" size="small" style={{ marginTop: 16 }}>
            <Row gutter={24}>
              <Col span={8}>
                <Form.Item label="Utbytte per aksje (NOK)" name="dividend_per_share">
                  <InputNumber
                    style={{ width: "100%" }}
                    min={0}
                    precision={2}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Totalt utbytte (NOK)" name="total_amount">
                  <InputNumber style={{ width: "100%" }} min={0} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        )}
      </Form>
    </Create>
  );
};
