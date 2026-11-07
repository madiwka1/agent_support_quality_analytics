import io
import xml.etree.ElementTree as ET
import zipfile

from app import xlsx

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def test_build_is_a_valid_workbook():
    data = xlsx.build([["Итог", 81.88], [], ["<&> кавычки \"", True, None]], [10, 20, 5], {0})
    z = zipfile.ZipFile(io.BytesIO(data))
    assert z.testzip() is None
    for name in z.namelist():
        if name.endswith((".xml", ".rels")):
            ET.fromstring(z.read(name))  # every part is well-formed XML
    rows = ET.fromstring(z.read("xl/worksheets/sheet1.xml")).findall(".//m:row", NS)
    cells = [[c.findtext(".//m:t", namespaces=NS) or c.findtext("m:v", namespaces=NS) for c in r] for r in rows]
    assert cells == [["Итог", "81.88"], [], ['<&> кавычки "', "Да"]]
    assert rows[0][0].get("s") == "1" and rows[2][0].get("s") == "0"
    assert [c.get("r") for c in rows[2]] == ["A3", "B3"]
    assert xlsx._col(0) == "A" and xlsx._col(25) == "Z" and xlsx._col(26) == "AA"
