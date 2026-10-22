export interface DistrictData {
  name: string;
  wards: string[];
}

export interface ProvinceData {
  name: string;
  districts: DistrictData[];
}

export const VIETNAM_PROVINCES: ProvinceData[] = [
  {
    name: 'TP. Hồ Chí Minh',
    districts: [
      {
        name: 'Quận 1',
        wards: ['Phường Bến Nghé', 'Phường Bến Thành', 'Phường Cầu Kho', 'Phường Cầu Ông Lãnh', 'Phường Cô Giang', 'Phường Đa Kao', 'Phường Nguyễn Cư Trinh', 'Phường Nguyễn Thái Bình', 'Phường Phạm Ngũ Lão', 'Phường Tân Định'],
      },
      {
        name: 'Quận 3',
        wards: ['Phường 1', 'Phường 2', 'Phường 3', 'Phường 4', 'Phường 5', 'Phường 9', 'Phường 10', 'Phường 11', 'Phường 12', 'Phường 13', 'Phường 14', 'Phường Võ Thị Sáu'],
      },
      {
        name: 'Quận 5',
        wards: ['Phường 1', 'Phường 2', 'Phường 3', 'Phường 4', 'Phường 5', 'Phường 6', 'Phường 7', 'Phường 8', 'Phường 9', 'Phường 10', 'Phường 11', 'Phường 12', 'Phường 13', 'Phường 14'],
      },
      {
        name: 'Quận 7',
        wards: ['Phường Bình Thuận', 'Phường Phú Mỹ', 'Phường Phú Thuận', 'Phường Tân Hưng', 'Phường Tân Kiểng', 'Phường Tân Phong', 'Phường Tân Phú', 'Phường Tân Quy', 'Phường Tân Thuận Đông', 'Phường Tân Thuận Tây'],
      },
      {
        name: 'Quận 10',
        wards: ['Phường 1', 'Phường 2', 'Phường 4', 'Phường 5', 'Phường 6', 'Phường 7', 'Phường 8', 'Phường 9', 'Phường 10', 'Phường 11', 'Phường 12', 'Phường 13', 'Phường 14', 'Phường 15'],
      },
      {
        name: 'Quận Bình Thạnh',
        wards: ['Phường 1', 'Phường 2', 'Phường 3', 'Phường 5', 'Phường 6', 'Phường 7', 'Phường 11', 'Phường 12', 'Phường 13', 'Phường 14', 'Phường 15', 'Phường 17', 'Phường 19', 'Phường 21', 'Phường 22', 'Phường 24', 'Phường 25', 'Phường 26', 'Phường 27', 'Phường 28'],
      },
      {
        name: 'Quận Gò Vấp',
        wards: ['Phường 1', 'Phường 3', 'Phường 4', 'Phường 5', 'Phường 6', 'Phường 7', 'Phường 8', 'Phường 9', 'Phường 10', 'Phường 11', 'Phường 12', 'Phường 13', 'Phường 14', 'Phường 15', 'Phường 16', 'Phường 17'],
      },
      {
        name: 'Quận Tân Bình',
        wards: ['Phường 1', 'Phường 2', 'Phường 3', 'Phường 4', 'Phường 5', 'Phường 6', 'Phường 7', 'Phường 8', 'Phường 9', 'Phường 10', 'Phường 11', 'Phường 12', 'Phường 13', 'Phường 14', 'Phường 15'],
      },
      {
        name: 'TP. Thủ Đức',
        wards: ['Phường An Khánh', 'Phường An Lợi Đông', 'Phường An Phú', 'Phường Bình Chiểu', 'Phường Bình Thọ', 'Phường Hiệp Bình Chánh', 'Phường Hiệp Bình Phước', 'Phường Hiệp Phú', 'Phường Linh Chiểu', 'Phường Linh Đông', 'Phường Linh Tây', 'Phường Linh Trung', 'Phường Linh Xuân', 'Phường Long Bình', 'Phường Long Phước', 'Phường Long Thạnh Mỹ', 'Phường Long Trường', 'Phường Phước Bình', 'Phường Phước Long A', 'Phường Phước Long B', 'Phường Tam Bình', 'Phường Tam Phú', 'Phường Tăng Nhơn Phú A', 'Phường Tăng Nhơn Phú B', 'Phường Thạnh Mỹ Lợi', 'Phường Thảo Điền', 'Phường Thủ Thiêm', 'Phường Trường Thạnh', 'Phường Trường Thọ'],
      },
      {
        name: 'Huyện Bình Chánh',
        wards: ['Thị trấn Tân Túc', 'Xã An Phú Tây', 'Xã Bình Chánh', 'Xã Bình Hưng', 'Xã Bình Lợi', 'Xã Đa Phước', 'Xã Hưng Long', 'Xã Lê Minh Xuân', 'Xã Phạm Văn Hai', 'Xã Phong Phú', 'Xã Quy Đức', 'Xã Tân Kiên', 'Xã Tân Nhựt', 'Xã Tân Quý Tây', 'Xã Vĩnh Lộc A', 'Xã Vĩnh Lộc B'],
      },
    ],
  },
  {
    name: 'Hà Nội',
    districts: [
      {
        name: 'Quận Ba Đình',
        wards: ['Phường Cống Vị', 'Phường Điện Biên', 'Phường Đội Cấn', 'Phường Giảng Võ', 'Phường Kim Mã', 'Phường Liễu Giai', 'Phường Ngọc Hà', 'Phường Ngọc Khánh', 'Phường Nguyễn Trung Trực', 'Phường Phúc Xá', 'Phường Quán Thánh', 'Phường Thành Công', 'Phường Trúc Bạch', 'Phường Vĩnh Phúc'],
      },
      {
        name: 'Quận Hoàn Kiếm',
        wards: ['Phường Chương Dương', 'Phường Cửa Đông', 'Phường Cửa Nam', 'Phường Đồng Xuân', 'Phường Hàng Bạc', 'Phường Hàng Bài', 'Phường Hàng Bồ', 'Phường Hàng Bông', 'Phường Hàng Buồm', 'Phường Hàng Đào', 'Phường Hàng Gai', 'Phường Hàng Mã', 'Phường Hàng Trống', 'Phường Lý Thái Tổ', 'Phường Phan Chu Trinh', 'Phường Phúc Tân', 'Phường Tràng Tiền', 'Phường Trần Hưng Đạo'],
      },
      {
        name: 'Quận Cầu Giấy',
        wards: ['Phường Dịch Vọng', 'Phường Dịch Vọng Hậu', 'Phường Mai Dịch', 'Phường Nghĩa Đô', 'Phường Nghĩa Tân', 'Phường Quan Hoa', 'Phường Trung Hòa', 'Phường Yên Hòa'],
      },
      {
        name: 'Quận Đống Đa',
        wards: ['Phường Cát Linh', 'Phường Hàng Bột', 'Phường Khâm Thiên', 'Phường Khương Thượng', 'Phường Kim Liên', 'Phường Láng Hạ', 'Phường Láng Thượng', 'Phường Nam Đồng', 'Phường Ngã Tư Sở', 'Phường Ô Chợ Dừa', 'Phường Phương Liên', 'Phường Phương Mai', 'Phường Quang Trung', 'Phường Quốc Tử Giám', 'Phường Thịnh Quang', 'Phường Thổ Quan', 'Phường Trung Liệt', 'Phường Trung Phụng', 'Phường Trung Tự', 'Phường Văn Chương', 'Phường Văn Miếu'],
      },
      {
        name: 'Quận Nam Từ Liêm',
        wards: ['Phường Cầu Diễn', 'Phường Đại Mỗ', 'Phường Mễ Trì', 'Phường Mỹ Đình 1', 'Phường Mỹ Đình 2', 'Phường Phú Đô', 'Phường Phương Canh', 'Phường Tây Mỗ', 'Phường Trung Văn', 'Phường Xuân Phương'],
      },
    ],
  },
  {
    name: 'Bình Dương',
    districts: [
      {
        name: 'TP. Thủ Dầu Một',
        wards: ['Phường Chánh Mỹ', 'Phường Chánh Nghĩa', 'Phường Định Hòa', 'Phường Hiệp An', 'Phường Hiệp Thành', 'Phường Hòa Phú', 'Phường Phú Cường', 'Phường Phú Hòa', 'Phường Phú Lợi', 'Phường Phú Mỹ', 'Phường Phú Tân', 'Phường Phú Thọ', 'Phường Tân An', 'Phường Tương Bình Hiệp'],
      },
      {
        name: 'TP. Dĩ An',
        wards: ['Phường An Bình', 'Phường Bình An', 'Phường Bình Thắng', 'Phường Dĩ An', 'Phường Đông Hòa', 'Phường Tân Bình', 'Phường Tân Đông Hiệp'],
      },
      {
        name: 'TP. Thuận An',
        wards: ['Phường An Phú', 'Phường An Thạnh', 'Phường Bình Chuẩn', 'Phường Bình Hòa', 'Phường Bình Nhâm', 'Phường Hưng Định', 'Phường Lái Thiêu', 'Phường Thuận Giao', 'Phường Vĩnh Phú', 'Xã An Sơn'],
      },
    ],
  },
  {
    name: 'Đồng Nai',
    districts: [
      {
        name: 'TP. Biên Hòa',
        wards: ['Phường An Bình', 'Phường An Hòa', 'Phường Bình Đa', 'Phường Bửu Hòa', 'Phường Bửu Long', 'Phường Hiệp Hòa', 'Phường Hóa An', 'Phường Hòa Bình', 'Phường Hố Nai', 'Phường Long Bình', 'Phường Long Bình Tân', 'Phường Phước Tân', 'Phường Quang Vinh', 'Phường Quyết Thắng', 'Phường Tam Hiệp', 'Phường Tam Hòa', 'Phường Tam Phước', 'Phường Tân Biên', 'Phường Tân Hạnh', 'Phường Tân Hiệp', 'Phường Tân Hòa', 'Phường Tân Mai', 'Phường Tân Phong', 'Phường Tân Tiến', 'Phường Tân Vạn', 'Phường Thanh Bình', 'Phường Thống Nhất', 'Phường Trảng Dài', 'Phường Trung Dũng', 'Xã Long Hưng'],
      },
      {
        name: 'Huyện Long Thành',
        wards: ['Thị trấn Long Thành', 'Xã An Phước', 'Xã Bàu Cạn', 'Xã Bình An', 'Xã Bình Sơn', 'Xã Cẩm Đường', 'Xã Lộc An', 'Xã Long An', 'Xã Long Đức', 'Xã Phước Bình', 'Xã Phước Thái', 'Xã Tam An', 'Xã Tân Hiệp'],
      },
    ],
  },
  {
    name: 'Đà Nẵng',
    districts: [
      {
        name: 'Quận Hải Châu',
        wards: ['Phường Bình Hiên', 'Phường Bình Thuận', 'Phường Hải Châu I', 'Phường Hải Châu II', 'Phường Hòa Cường Bắc', 'Phường Hòa Cường Nam', 'Phường Hòa Thuận Đông', 'Phường Hòa Thuận Tây', 'Phường Nam Dương', 'Phường Phước Ninh', 'Phường Thạch Thang', 'Phường Thanh Bình', 'Phường Thuận Phước'],
      },
      {
        name: 'Quận Sơn Trà',
        wards: ['Phường An Hải Bắc', 'Phường An Hải Đông', 'Phường An Hải Tây', 'Phường Mân Thái', 'Phường Nại Hiên Đông', 'Phường Phước Mỹ', 'Phường Thọ Quang'],
      },
      {
        name: 'Quận Ngũ Hành Sơn',
        wards: ['Phường Hòa Hải', 'Phường Hòa Quý', 'Phường Khuê Mỹ', 'Phường Mỹ An'],
      },
    ],
  },
  {
    name: 'Cần Thơ',
    districts: [
      {
        name: 'Quận Ninh Kiều',
        wards: ['Phường An Bình', 'Phường An Cư', 'Phường An Hòa', 'Phường An Khánh', 'Phường An Nghiệp', 'Phường An Phú', 'Phường Cái Khế', 'Phường Hưng Lợi', 'Phường Tân An', 'Phường Thới Bình', 'Phường Xuân Khánh'],
      },
      {
        name: 'Quận Cái Răng',
        wards: ['Phường Ba Láng', 'Phường Hưng Phú', 'Phường Hưng Thạnh', 'Phường Lê Bình', 'Phường Phú Thứ', 'Phường Tân Phú', 'Phường Thường Thạnh'],
      },
    ],
  },
];
