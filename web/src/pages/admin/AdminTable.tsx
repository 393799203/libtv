import { Table, type TableProps } from 'antd';
import { useIsMobile } from '@/hooks/useIsMobile';

/** Keep desktop columns while presenting labelled records on phones. */
export function AdminTable<T extends object>({ columns, pagination, scroll, className, ...props }: TableProps<T>) {
  const mobile = useIsMobile();
  const responsiveColumns = mobile ? columns?.map(column => ({
    ...column,
    fixed: undefined,
    width: undefined,
    ellipsis: false,
    onCell: (record: T, index?: number) => ({
      ...column.onCell?.(record, index),
      'data-label': typeof column.title === 'string' ? column.title : '',
    }),
  })) : columns;
  return <Table<T> {...props} className={`admin-responsive-table ${className || ''}`}
    columns={responsiveColumns} scroll={mobile ? undefined : scroll}
    pagination={mobile && pagination ? { ...pagination, simple: true, showSizeChanger: false } : pagination} />;
}
